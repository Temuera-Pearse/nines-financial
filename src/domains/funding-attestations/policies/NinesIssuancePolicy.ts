import { AppError } from '../../../shared/types/AppError.js'

export const usdcToNinesParV1 = Object.freeze({
  policyVersion: 'usdc-to-nines-par-v1',
  inputAsset: 'USDC',
  inputScale: 6,
  outputCurrency: 'NINES',
  outputScale: 6,
  rateNumerator: 1n,
  rateDenominator: 1n,
})

export interface NinesIssuanceDecision {
  policyVersion: string
  currency: 'NINES'
  scale: 6
  minorUnits: string
}

export function applyNinesIssuancePolicy(input: { asset: string; scale: number;
  atomicUnits: string }): NinesIssuanceDecision {
  const policy = usdcToNinesParV1
  if (input.asset !== policy.inputAsset || input.scale !== policy.inputScale ||
      !/^[1-9][0-9]*$/.test(input.atomicUnits)) {
    throw new AppError({ category: 'validation_error', code: 'UNSUPPORTED_PURCHASE_ASSET',
      message: 'No NINES issuance policy supports these external payment facts' })
  }
  const inputUnits = BigInt(input.atomicUnits)
  const numerator = inputUnits * policy.rateNumerator
  if (numerator % policy.rateDenominator !== 0n) {
    throw new AppError({ category: 'invariant_violation', code: 'NON_INTEGRAL_NINES_ISSUANCE',
      message: 'The selected policy did not resolve to exact NINES minor units' })
  }
  return { policyVersion: policy.policyVersion, currency: policy.outputCurrency,
    scale: policy.outputScale, minorUnits: (numerator / policy.rateDenominator).toString() }
}
