import { randomUUID } from 'node:crypto'

import type { Database, QueryResultRow } from '../db/Database.js'
import type { JsonObject } from '../types/Json.js'
import { hashCanonicalJson } from '../contracts/canonicalJson.js'
import { signServiceMessage } from '../security/ServiceMessageAuthentication.js'

interface EvidenceRow extends QueryResultRow { event_id: string; payload: JsonObject; attempt_count: number; lease_token: string }
const PATH = '/internal/v1/evidence'

export class SecurityEvidenceDeliveryWorker {
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<void> | null = null
  constructor(private readonly database: Database, private readonly baseUrl: string,
    private readonly environment: string, private readonly secret: string,
    private readonly keyId: string, private readonly pollIntervalMs = 1000,
    private readonly fetcher: typeof fetch = fetch, private readonly clock: () => Date = () => new Date()) {}
  start(): void { if (this.timer) return; this.runOnce(); this.timer=setInterval(()=>this.runOnce(),this.pollIntervalMs); this.timer.unref() }
  async stop(): Promise<void> { if (this.timer) clearInterval(this.timer); this.timer=null; await this.inFlight }
  private runOnce(): void { if (this.inFlight) return; this.inFlight=this.deliverOne()
    .catch((error: unknown)=>{ process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`) })
    .finally(()=>{this.inFlight=null}) }
  private async deliverOne(): Promise<void> {
    const leaseToken=randomUUID()
    const result = await this.database.query<EvidenceRow>(`UPDATE security_evidence_outbox SET
      attempt_count=attempt_count+1,next_attempt_at=NOW()+INTERVAL '60 seconds',lease_token=$1
      WHERE event_id=(SELECT event_id FROM security_evidence_outbox
        WHERE delivery_status IN ('pending','retry_wait') AND next_attempt_at<=NOW()
        ORDER BY created_at,event_id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING event_id,payload,attempt_count,lease_token`,[leaseToken])
    const row=result.rows[0]; if (!row) return
    const requestId=randomUUID(); const sentAt=this.clock().toISOString(); const contentHash=hashCanonicalJson(row.payload)
    const signature=signServiceMessage({method:'POST',path:PATH,environment:this.environment,
      serviceId:'nines-financial',keyId:this.keyId,requestId,sentAt,contentHash,secret:this.secret})
    try {
      const response=await this.fetcher(`${this.baseUrl}${PATH}`,{method:'POST',headers:{
        'content-type':'application/json','x-nines-service-id':'nines-financial',
        'x-nines-key-id':this.keyId,'x-nines-request-id':requestId,'x-nines-sent-at':sentAt,
        'x-nines-content-sha256':contentHash,'x-nines-signature':signature},
        body:JSON.stringify(row.payload),signal:AbortSignal.timeout(10_000)})
      if (response.status===200||response.status===201) {
        await this.database.query(`UPDATE security_evidence_outbox SET delivery_status='delivered',
          delivered_at=NOW(),lease_token=NULL WHERE event_id=$1 AND lease_token=$2
          AND delivery_status IN ('pending','retry_wait')`,[row.event_id,row.lease_token]); return
      }
      await this.retry(row,response.status>=400&&response.status<500&&response.status!==408&&response.status!==429)
    } catch { await this.retry(row,false) }
  }
  private async retry(row: EvidenceRow, permanent: boolean): Promise<void> {
    await this.database.query(`UPDATE security_evidence_outbox SET delivery_status=$2,
      next_attempt_at=NOW()+($3::text||' seconds')::interval,lease_token=NULL
      WHERE event_id=$1 AND lease_token=$4 AND delivery_status IN ('pending','retry_wait')`,
    [row.event_id,permanent||row.attempt_count>=12?'dead_letter':'retry_wait',
      Math.min(3600,2**Math.min(row.attempt_count,11)),row.lease_token])
  }
}
