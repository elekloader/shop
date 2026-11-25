// SPDX-License-Identifier: GPL-3.0-or-later
// The DSP code inside a main OS: the payloads its ColdFire uploads to the DSP cores at boot. Ported from elekloader's
// dsp.py (GPL-2.0-or-later), which says more.
//
// A payload is 24-bit little-endian words: records [space, address, count, count words], space 0 = P, 1 = X, 2 = Y,
// and two-word directives led by 3 or 4. A word above 4 also ends it. The linker places DSP code in the P words of a
// payload that a mod frees (the profile's dspAreas); those words are bytes of the main OS at the addresses pSpan gives.
                                          
import { ModError } from './elemod.js'

/** A 24-bit little-endian word, as the ColdFire's loader assembles it. */
export const w24 = (b            , i        )         => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)

const h5 = (v        ) => v.toString(16).padStart(5, '0')

/** -> [space, address, count, main OS address of its first word] of payload `tag`. */
export function records(image            , dev        , tag        )                                     {
  if (!Object.hasOwn(dev.dspPayloads, tag)) throw new ModError(`the ${dev.name} has no DSP payload ${tag}`)
  const [at, n] = dev.dspPayloads[tag]
  const b = image.subarray(at - dev.mainLoad, at - dev.mainLoad + n)
  if (b.length !== n) throw new ModError(`DSP payload ${tag} runs past the main OS`)
  let off = 0
  const out                                     = []
  while (off + 3 <= n) {
    const sp = w24(b, off)
    if (sp > 4) return out
    if (sp >= 3) {                            // a two-word directive
      off += 6
      continue
    }
    if (off + 9 > n) break
    const addr = w24(b, off + 3), cnt = w24(b, off + 6)
    if (!cnt || off + 9 + 3 * cnt > n) break
    out.push([sp, addr, cnt, at + off + 9])
    off += 9 + 3 * cnt
  }
  if (off === n) return out
  throw new ModError(`DSP payload ${tag} does not parse at +0x${off.toString(16)}`)
}

/** The main OS address of payload `tag`'s P words lo..hi-1, which must lie in one record. */
export function pSpan(image            , dev        , tag        , lo        , hi        )         {
  for (const [sp, addr, cnt, at] of records(image, dev, tag)) {
    if (sp === 0 && addr <= lo && hi <= addr + cnt) return at + 3 * (lo - addr)
  }
  throw new ModError(`payload ${tag} does not load P:0x${h5(lo)}-0x${h5(hi - 1)} in one record`)
}
