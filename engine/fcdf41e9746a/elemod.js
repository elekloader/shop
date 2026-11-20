// SPDX-License-Identifier: GPL-3.0-or-later
// The .elemod file: shared validation, format 1 (whole-build bundles), the instruction-boundary check, and apply for
// bundles. Format 2 (separate, linkable mods) is link.ts. Ported from elekloader's elemod.py (GPL-2.0-or-later);
// the format is docs/FORMAT.md. Every refusal says what the Python says.
//
// A .elemod is JSON. It carries only its author's bytes plus hashes of the stock bytes it expects. Format 2 may
// carry a profiled DN2 SHARC mod; all other sections, including the bootloader, stay stock.
import { concat, encodeAsciiReplace, equal, fromHex, sha } from './bytes.js'
import {                            SYX_FAMILIES, UnknownFirmware, forTarget, imageEnd, linkable } from './devices.js'
import { ILLEGAL, LINEF, FPU, decodeColdFire, readerAt } from './isa/coldfire.js'
import { AttributeError, PyFloat, TypeError_, ValueError, hex8, pyInt, pyType, repr, str, truthy } from './py.js'
import { decodeUtf8, loads } from './pyjson.js'

export const FORMAT = 1
export const EXTS = ['.elemod', '.dtmod']   // what the loader lists; the SDK writes .elemod

export class ModError extends Error {}

/** Python's ==, for a JSON value and an int: True == 1 and 1.0 == 1 there. */
export const pyEq = (v         , n        )          =>
  v === n || (typeof v === 'boolean' && Number(v) === n) || (v instanceof PyFloat && v.value === n)

/** The file's format number, from "elemod" or the legacy "dtmod". */
export function formatOf(doc         )          {
  if (!isDict(doc)) return null
  return 'elemod' in doc ? doc.elemod : ('dtmod' in doc ? doc.dtmod : null)
}

export const isDict = (v         )                           =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof PyFloat)

/** d.get(k, default), and Python's AttributeError when d is not a dict. */
export function get(d         , k        , dflt          = null)      {
  if (!isDict(d)) throw new AttributeError(`'${pyType(d)}' object has no attribute 'get'`)
  return k in d ? d[k] : dflt
}

/** elemod._int: an int, or a string Python's int(v, 0) reads. */
export function int(v         , what        )         {
  const n = pyInt(v)
  if (n === null) throw new ModError(`${what}: ${repr(v)} is not a number`)
  return n
}

export function hexBytes(v         , what        )             {
  const b = typeof v === 'string' ? fromHex(v) : null
  if (!b) throw new ModError(`${what}: not hex`)
  return b
}

/** -> [Device, Release] for a mod's "target", or ModError. */
export function resolveTarget(doc                     , name        )                    {
  try {
    return forTarget(get(doc, 'target'))
  } catch (e) {
    if (e instanceof UnknownFirmware) throw new ModError(`${name}: ${e.message}`)
    throw e
  }
}

                                                                  

/** [["hex", "..."] | ["stock", addr, n], ...] -> parts. A stock part is n bytes the patcher copies from the user's
 * own (hash-checked) stock image: what a mod repeats from the firmware is never shipped. */
export function parseParts(parts         , what        , dev        , rel         )         {
  const lo = dev.mainLoad, hi = imageEnd(dev, rel)
  const out         = []
  for (const p of iter(parts)) {
    const list = Array.isArray(p) ? p : null
    if (list && list.length && list[0] === 'hex' && list.length === 2) {
      out.push(['hex', hexBytes(list[1], what + ' part')])
    } else if (list && list.length && list[0] === 'stock' && list.length === 3) {
      const a = int(list[1], what + ' part'), k = int(list[2], what + ' part')
      if (a < lo || a + k > hi || k <= 0) throw new ModError(`${what}: a part copies ${hex8(a)} +${k}, outside the image`)
      out.push(['stock', a, k])
    } else {
      throw new ModError(`${what}: bad part ${repr(p)}`)
    }
  }
  return out
}

/** Iterating a JSON value as Python would: a list's items, a dict's keys, a string's characters; TypeError else. */
export function iter(v         )            {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return Array.from(v)
  if (isDict(v)) return Object.keys(v)
  throw new TypeError_(`'${pyType(v)}' object is not iterable`)
}

export const partsLen = (parts        )         => parts.reduce((n, p) => n + (p[0] === 'hex' ? p[1].length : p[2]), 0)

export function partsBytes(parts        , image            , dev        )             {
  return concat(parts.map(p => (p[0] === 'hex' ? p[1] : image.subarray(p[1] - dev.mainLoad, p[1] - dev.mainLoad + p[2]))))
}

                                                              // offset, type, target, addend

/** Each relocation type's size in bytes. */
export const RSIZE = new Map([['abs32', 4], ['abs16', 2], ['pc32', 4], ['pc16', 2], ['dsp24', 3]])
                                                                                                                      

export function sharcSite(rel         , address        )                               {
  return rel.sharc?.dataSites?.[address]
}

export function parseSites(doc                     , name        , dev        , rel         , relocs = false)         {
  const lo = dev.mainLoad, hi = imageEnd(dev, rel)
  const out         = []
  iter(get(doc, 'sites', [])).forEach((s, i) => {
    const what = `${name} site ${i}`
    const addr = int(get(s, 'addr'), what), n = int(get(s, 'len'), what)
    const nw = hexBytes(get(s, 'new'), what)
    if (nw.length !== n || n <= 0) throw new ModError(`${what}: "new" is not ${n} bytes`)
    const dspSite = relocs ? sharcSite(rel, addr) : undefined
    if ((addr < lo || addr + n > hi) && !dspSite) throw new ModError(`${what}: ${hex8(addr)} +${n} is outside the stock image`)
    const kind = get(s, 'kind')
    if (kind !== 'code' && kind !== 'data') throw new ModError(`${what}: kind is "code" or "data"`)
    const h = get(s, 'stock_sha256')
    if (typeof h !== 'string' || h.length !== 64) throw new ModError(`${what}: no stock_sha256`)
    const site       = { addr, len: n, new: nw, kind, stock_sha256: h.toLowerCase(), relocs: [] }
    if (relocs) {
      for (const r of iter(get(s, 'relocs', []))) {
        const [off0, typ, tgt, add] = unpack(r, 4)
        const off = int(off0, what)
        const size = typeof typ === 'string' ? RSIZE.get(typ) : undefined
        if (size === undefined || off < 0 || off + size > n) throw new ModError(`${what}: bad relocation ${repr(r)}`)
        site.relocs.push([off, typ          , tgt          , int(add, what)])
      }
    }
    if (dspSite && (kind !== 'data' || site.relocs.length || sha(hexBytes(dspSite[0], what)) !== h.toLowerCase() ||
      !equal(nw, hexBytes(dspSite[1], what)))) throw new ModError(`${what}: unqualified SHARC data site`)
    out.push(site)
  })
  return out
}

/** Python's `a, b, ... = r` for `n` names. */
export function unpack(r         , n        )            {
  const v = iter(r)
  if (v.length > n) throw new ValueError(`too many values to unpack (expected ${n})`)
  if (v.length < n) throw new ValueError(`not enough values to unpack (expected ${n}, got ${v.length})`)
  return v
}

                                                                           

export function parseResources(doc                     , name        , dev        )                       {
  const r0 = get(doc, 'resources'), r = truthy(r0) ? r0 : {}
  const regions           = []
  for (const g of iter(get(r, 'regions', []))) {
    const lo = int(get(g, 'lo'), name + ' region'), hi = int(get(g, 'hi'), name + ' region')
    if (!(lo < hi)) throw new ModError(`${name}: empty region ${repr(g)}`)
    const area = Object.entries(dev.areas).filter(([, [a, z]]) => a <= lo && hi <= z).map(([k]) => k)
    if (!area.length) throw new ModError(`${name}: region ${str(get(g, 'name'))} ${hex8(lo)}-${hex8(hi)} is outside every free area`)
    regions.push({ name: str(get(g, 'name', '?')), lo, hi, area: area[0] })
  }
  return [regions, iter(get(r, 'names', [])).map(x => str(x))]
}

/** The core version a mod's resources.core says it needs ("3.0"), or null. elekloader 0.4.0 and older read only regions and
 * names there, so they ignore it; the imports such a mod makes still fail to link against an older core. */
export function parseNeedsCore(doc                     , name        )                {
  const r0 = get(doc, 'resources'), v = get(truthy(r0) ? r0 : {}, 'core')
  if (v === null) return null
  if (typeof v !== 'string' || !(v.slice(0, 1) >= '0' && v.slice(0, 1) <= '9'))
    throw new ModError(`${name}: resources.core is the version of core it needs, such as "3.0"`)
  return v
}

                                           

/** A version as it sorts: its runs of digits as numbers (2.10 after 2.9), the rest as text, digits first (2.0
 * before 2.0a before 2.1). elemod.version_key. */
export function versionKey(v        )                {
  return (String(v).match(/[0-9]+|[^0-9]+/g) ?? []).map((x)              => (x[0] >= '0' && x[0] <= '9' ? [0, BigInt(x), ''] : [1, 0n, x]))
}

function cmpKey(a               , b               )         {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    for (let j = 0; j < 3; j++) {
      const x = a[i][j], y = b[i][j]
      if (x < y) return -1
      if (x > y) return 1
    }
  }
  return a.length - b.length
}

/** a against b, in versionKey's order: < 0, 0 or > 0. */
export const cmpVersions = (a        , b        ) => cmpKey(versionKey(a), versionKey(b))

/** The core a builder takes for a selection: of `versions` (the cores for one device and OS), the newest, if it is at
 * least `need`. Each core keeps all of the one before it, so a mod built for an older core links with the newest as it
 * did with its own, unless it patches a place the newer core has since taken. `fits`, if given, says for each core
 * whether it takes the selection's mods (model.ts withCore: its RAM holds them, and it patches no place one of them
 * patches): only those that do count, unless none new enough does. -> its index (the last of equals), or null when
 * none is new enough. elemod.pick_core. */
export function pickCore(versions          , need                = null, fits                   = null)                {
  let ok = versions.map((_, i) => i).filter(i => need === null || cmpVersions(versions[i], need) >= 0)
  if (!ok.length) return null
  if (fits !== null && ok.some(i => fits[i])) ok = ok.filter(i => fits[i])
  let best = ok[0]
  for (const i of ok) if (cmpVersions(versions[i], versions[best]) >= 0) best = i
  return best
}

/** Whether a core takes mods, each as describe() lists it (gui.with_core's takes): it holds them, its area (ram_area)
 * at least their ram_bound and its own, and patches no byte one of them patches (sites). A whole build's sites count
 * for nothing: it goes with no core at all, and the check says so. */
export function coreTakes(core                     , mods                                )          {
  const ram = mods.reduce((n, x) => n + (x.ram_bound ?? 0), 0)
  if ('ram_area' in core && ram + (core.ram_bound ?? 0) > core.ram_area) return false
  const theirs = mods.filter(x => x.format !== 1).flatMap(x => (x.sites ?? [])              ).map(s => [s[0], s[0] + s[1]])
  return !((core.sites ?? [])              ).some(s => theirs.some(([lo, hi]) => s[0] < hi && lo < s[0] + s[1]))
}

export const COMMON = new Set(['elemod', 'dtmod', 'id', 'version', 'title', 'description', 'category', 'author',
  'license', 'target', 'sites', 'resources', 'requires', 'conflicts', 'build', 'signature', 'notes'])

/** What both formats share: the loader treats a format-1 Mod and a format-2 Mod2 alike for these. */
                      
               
                          
              
                       
            
                 
             
              
               
                   
                   
                 
                    
                     
                                                          
                                                                          
                 
 

                                                                               

/** A format-1 mod: a whole build as one file (sites + one appended blob). */
export class Mod                   {
           format = 1
  doc                     
  name        
  sha256               
  id        
  version        
  dev        
  rel         
  sites        
  blob             
  regions          
  names          
  requires          
  conflicts          

  constructor(doc                     , name = '<mod>', raw                    = null) {
    this.doc = doc
    this.name = name
    this.sha256 = raw ? sha(raw) : null
    if (!pyEq(formatOf(doc), FORMAT)) throw new ModError(`${name}: not a format-${FORMAT} .elemod file`)
    for (const k of ['id', 'version', 'target', 'sites']) if (!(k in doc)) throw new ModError(`${name}: no "${k}"`)
    const extra = Object.keys(doc).filter(k => !COMMON.has(k) && k !== 'ele3_version' && k !== 'blob').sort()
    if (extra.length) throw new ModError(`${name}: unknown fields ${repr(extra)}`)
    this.id = str(doc.id)
    this.version = str(doc.version)
    ;[this.dev, this.rel] = resolveTarget(doc, name)
    const ev = get(doc, 'ele3_version')              // the version the unit shows (any device)
    if (ev !== null) {
      const n = typeof ev === 'string' ? encodeAsciiReplace(ev).length : -1
      const exact = SYX_FAMILIES.includes(this.dev.container)
      if ((exact && n !== this.dev.versionLen) || !(n > 0 && n <= this.dev.versionLen))
        throw new ModError(`${name}: ele3_version is ${exact ? 'exactly' : 'up to'} ${this.dev.versionLen} ASCII characters on the ${this.dev.name}`)
    }
    this.sites = parseSites(doc, name, this.dev, this.rel)
    this.blob = null
    const b = get(doc, 'blob')
    if (b !== null) {
      const load = int(get(b, 'load'), name + ' blob'), n = int(get(b, 'len'), name + ' blob')
      const parts = parseParts(get(b, 'parts', []), name + ' blob', this.dev, this.rel)
      const total = partsLen(parts)
      if (total !== n) throw new ModError(`${name}: blob parts make ${total} bytes, not ${n}`)
      const room = this.dev.blobMax !== null ? this.dev.blobMax : (linkable(this.dev) ? this.dev.ddr[1] - this.dev.ddr[0] : null)
      if (room !== null && n > room) throw new ModError(`${name}: blob of ${n} bytes is over the ${room} the ${this.dev.name} allows`)
      this.blob = { load, len: n, sha256: str(get(b, 'sha256', '')).toLowerCase(), parts }
    }
    ;[this.regions, this.names] = parseResources(doc, name, this.dev)
    this.requires = iter(get(doc, 'requires', [])).map(x => str(x))
    this.conflicts = iter(get(doc, 'conflicts', [])).map(x => str(x))
  }

  label()         { return `${this.id} ${this.version}` }
}

/** The JSON of a .elemod's bytes, or ModError as read_json gives it. */
export function readJson(raw            , path        )          {
  try {
    return loads(decodeUtf8(raw))
  } catch (e) {
    throw new ModError(`${path}: not JSON (${(e         ).message})`)
  }
}

// ---- instruction boundaries ----

/** Does [addr, addr+n) of `image` (loaded at dev.mainLoad) hold whole instructions? -> [ok, note]. The end is
 * exact: decoding from addr must land on addr+n with no illegal word. The start cannot be proven by decoding
 * forward, so `sweeps` linear sweeps, started 32 to 94 bytes before addr, must all land on it (elemod.py). */
export function insnCheck(image            , addr        , n        , dev        , sweeps = 32)                    {
  const read = readerAt(image, dev.mainLoad)
  const bad = ILLEGAL | LINEF | FPU
  let a = addr
  while (a < addr + n) {
    const ins = decodeColdFire(read(a), a)
    if (ins.flags & bad) return [false, `${hex8(a)} does not decode`]
    a += ins.length
  }
  if (a !== addr + n) return [false, `ends mid-instruction (${hex8(a)})`]
  let land = 0, ran = 0
  for (let k = 16; k < 16 + sweeps; k++) {
    let pc = addr - 2 * k
    if (pc < dev.mainLoad) break
    while (pc < addr) pc += decodeColdFire(read(pc), pc).length
    ran++
    if (pc === addr) land++
  }
  if (land !== ran) return [false, `only ${land} of ${ran} sweeps land on the start`]
  return [true, 'whole instructions']
}

// ---- the static check, and apply for bundles ----

                                                        

/** [(lo, hi, ...)] -> every pair that shares a byte. */
export function overlaps                                          (spans     )           {
  const s = spans.map((x, i) => [x, i]         ).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1] || a[1] - b[1]).map(([x]) => x)
  const out           = []
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j][0] >= s[i][1]) break
      out.push([s[i], s[j]])
    }
  }
  return out
}

/** -> problems if the mods were made for different firmware. */
export function sameTarget(mods          )           {
  const ts = new Set(mods.map(m => m.dev.key + '\0' + m.rel.version))
  if (ts.size > 1) return ['the mods are for different firmware: ' + mods.map(m => `${m.label()} (${m.dev.name} ${m.rel.version})`).join(', ')]
  return []
}

const pyCount =    (xs     , x   ) => xs.filter(y => y === x).length
const sortedStr = (xs                  ) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/** The checks both formats share. `spans`: [lo, hi, mod, what] of image bytes each mod changes or claims. */
export function commonChecks(mods          , image            , spans                )           {
  const bad = sameTarget(mods)
  const ids = mods.map(m => m.id)
  for (const i of sortedStr(new Set(ids))) if (pyCount(ids, i) > 1) bad.push(`mod ${i} is given ${pyCount(ids, i)} times`)
  for (const m of mods) {
    for (const r of m.requires) if (!ids.includes(r)) bad.push(`${m.label()} requires ${r}`)
    for (const c of m.conflicts) if (ids.includes(c)) bad.push(`${m.label()} conflicts with ${c}`)
  }
  for (const [a, b] of overlaps(spans)) {
    if (a[2] === b[2] && a[3] === b[3]) continue
    bad.push(`${a[2] .label()} ${a[3]} and ${b[2] .label()} ${b[3]} overlap (${hex8(b[0])}-${hex8(Math.min(a[1], b[1]))})`)
  }
  const owner = new Map                ()
  for (const m of mods) {
    for (const nm of m.names) {
      if (owner.has(nm) && owner.get(nm) !== m) bad.push(`${owner.get(nm) .label()} and ${m.label()} both claim ${nm}`)
      owner.set(nm, m)
    }
  }
  if (bad.length && bad[0].startsWith('the mods are for different firmware')) return bad
  const dev = mods[0].dev
  for (const m of mods) {
    for (const s of m.sites) {
      for (const [lo, hi, why] of dev.protected) {
        if (s.addr < hi && lo < s.addr + s.len)
          bad.push(`${m.label()} site ${hex8(s.addr)} is inside ${hex8(lo)}-${hex8(hi)}, ${why}: protected on the ${dev.name}`)
      }
      for (const [lo, hi, why] of dev.keep) {
        if (s.addr < hi && lo < s.addr + s.len)
          bad.push(`${m.label()} site ${hex8(s.addr)} writes into ${hex8(lo)}-${hex8(hi)}, which stays stock on the ${dev.name}: ${why}`)
      }
    }
  }
  for (const m of mods) {
    for (const s of m.sites) {
      const o = s.addr - dev.mainLoad
      const dspSite = sharcSite(m.rel, s.addr)
      const stock = dspSite ? hexBytes(dspSite[0], m.name) : image.subarray(o, o + s.len)
      if (sha(stock) !== s.stock_sha256) {
        bad.push(`${m.label()} site ${hex8(s.addr)}: the stock bytes are not the ones it expects`)
      } else if (s.kind === 'code') {
        const [ok, note] = insnCheck(image, s.addr, s.len, dev)
        if (!ok) bad.push(`${m.label()} site ${hex8(s.addr)}: ${note}`)
      }
    }
  }
  return bad
}

const FOLLOW_ON = ['imports ', 'adds to table ', 'has .fast code']

/** The checker's lines, for a person: a mod that lacks a requirement, or needs a newer core than the one given, shows
 * that, not what follows from it; repeats are merged with a count; "no .boot" says that core is not enabled. */
export function summarize(problems          , mods          )           {
  const ids = new Set(mods.map(m => m.id))
  const lacking = new Set(mods.filter(m => m.requires.some(r => !ids.has(r))).map(m => m.label()))
  const cores = mods.filter(m => m.sections?.has('.boot'))
  if (cores.length === 1) {
    for (const m of mods) if (m.needsCore && cmpVersions(cores[0].version, m.needsCore) < 0) lacking.add(m.label())
  }
  const out           = [], count = new Map                ()
  for (let x of problems) {
    if ([...lacking].some(lab => x.startsWith(lab + ' ') && FOLLOW_ON.some(f => x.includes(f)))) continue
    if (x.startsWith('exactly one mod must carry .boot') && x.endsWith('got none')) x = 'core is not enabled, and every other mod builds on it'
    if (!count.has(x)) out.push(x)
    count.set(x, (count.get(x) ?? 0) + 1)
  }
  return out.map(x => (count.get(x) === 1 ? x : `${x} (${count.get(x)} times)`))
}

/** The static conflict check for format-1 mods. -> problems. */
export function check(mods       , image            )           {
  const spans                 = []
  for (const m of mods) {
    for (const s of m.sites) spans.push([s.addr, s.addr + s.len, m, `site ${hex8(s.addr)}`])
    if (m.blob) spans.push([m.blob.load, m.blob.load + m.blob.len, m, 'blob'])
  }
  const bad = commonChecks(mods, image, spans)
  const regs                 = mods.flatMap(m => m.regions.map(g => [g.lo, g.hi, m, 'region ' + g.name]                ))
  for (const [a, b] of overlaps(regs))
    bad.push(`${a[2] .label()} ${a[3]} and ${b[2] .label()} ${b[3]} overlap (${hex8(b[0])}-${hex8(Math.min(a[1], b[1]))})`)
  const blobs = mods.filter(m => m.blob)
  if (blobs.length > 1) bad.push(`more than one whole build (${blobs.map(m => m.label()).join(', ')})`)
  for (const m of blobs) {
    const end = imageEnd(m.dev, m.rel)
    if (m.blob .load !== end) bad.push(`${m.label()}: its blob loads at ${hex8(m.blob .load)}, not the image end ${hex8(end)}`)
  }
  return bad
}

/** -> the mod's blob, its stock parts copied from `image`. */
export function blobBytes(mod     , image            )             {
  const out = partsBytes(mod.blob .parts, image, mod.dev)
  if (sha(out) !== mod.blob .sha256) throw new ModError(`${mod.label()}: the blob does not assemble to its sha256`)
  return out
}

/** Format-1 mods -> the patched main OS image. ModError with every problem the check finds. */
export function apply(mods       , image            )             {
  const rel = mods[0].rel
  if (sha(image) !== rel.mainSha256) throw new ModError(`the stock main OS is not ${mods[0].dev.name} ${rel.version}`)
  const bad = summarize(check(mods, image), mods)
  if (bad.length) throw new ModError('the mods do not combine:\n  ' + bad.join('\n  '))
  const dev = mods[0].dev
  const img = image.slice()
  for (const m of mods) for (const s of m.sites) img.set(s.new, s.addr - dev.mainLoad)
  const blobs = mods.filter(m => m.blob).map(m => blobBytes(m, image))
  return blobs.length ? concat([img, ...blobs]) : img
}

export { PyFloat }
