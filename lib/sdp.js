
/**
 * TODO tidy all of teh ts-ignores in favour of defining data structures better.
 */

const sdptransform = require( "sdp-transform" )
const crypto = require( "crypto" )

/*
  An SDP Generator.
*/
let sessionidcounter = Math.floor( Math.random() * 100000 )


const prtpcodecpts = {
  "pcmu": 0,
  "pcma": 8,
  "g722": 9,
  "ilbc": 97,
  "2833": 101
}

class codecconv {

  /* pt<->name maps are per media type: video payload types are always
     dynamic (96-127) and freely collide with audio's dynamic bookkeeping
     (ilbc=97 etc), so one flat map cannot hold both. Every accessor
     defaults to "audio" so existing callers behave exactly as before. */
  #pt2name = {
    "audio": {
      "0": "pcmu",
      "8": "pcma",
      "9": "g722",
      "97": "ilbc",
      "101": "2833"
    },
    "video": {
      "96": "vp8",
      "102": "h264"
    }
  }

  #name2pt = {
    "audio": {
      "pcmu": 0,
      "pcma": 8,
      "g722": 9,
      "ilbc": 97,
      "2833": 101
    },
    "video": {
      "vp8": 96,
      "h264": 102
    }
  }

  #defs = {
    "type": {
      "pcmu": "audio",
      "pcma": "audio",
      "g722": "audio",
      "ilbc": "audio",
      "2833": "audio",
      "vp8": "video",
      "h264": "video",
    },
    "rtp": {
      "pcmu": {
        payload: 0,
        codec: "PCMU",
        rate: 8000
      },
      "pcma": {
        payload: 8,
        codec: "PCMA",
        rate: 8000
      },
      "g722": {
        payload: 9,
        codec: "G722",
        rate: 8000
      },
      "ilbc": {
        payload: 97,
        codec: "ilbc",
        rate: 8000
      },
      "2833": {
        payload: 101,
        codec: "telephone-event/8000"
      },
      "vp8": {
        payload: 96,
        codec: "VP8",
        rate: 90000
      },
      "h264": {
        payload: 102,
        codec: "H264",
        rate: 90000
      }
    },
    "fmtp": {
      "ilbc": {
        payload: 97,
        config: "mode=20"
      },
      "2833": {
        payload: 101,
        config: "0-16"
      }, /* 0-16 = DTMF */
      "h264": {
        payload: 102,
        config: "profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1"
      } /* constrained baseline - the mobile-safe profile */
    }
  }

  /**
   *
   * @param { "pcma" | "pcmu" | "g722" | "ilbc" | "2833" | "vp8" | "h264" } name
   * @param { string } codec the codec name as it appears in SDP i.e. "telephone-event" or "G722"
   * @param { number } pt
   * @param { string } [ type ] media type the pt belongs to - defaults audio
   */
  setdynamicpt( name, codec, pt, type = "audio" ) {

    const pt2name = this.#pt2name[ type ]
    const name2pt = this.#name2pt[ type ]

    for ( const pt2namept in pt2name ) {
      if( codec == pt2name[ pt2namept ] ) {
        delete pt2name[ pt2namept ]
        delete name2pt[ codec ]
        break
      }
    }

    pt2name[ pt ] = name
    name2pt[ codec ] = pt
    this.#defs.rtp[ name ].payload = pt
    /* not every codec carries an fmtp (vp8 has none) */
    if( this.#defs.fmtp[ name ] ) this.#defs.fmtp[ name ].payload = pt
  }

  /**
   *
   * @param { string } pt
   * @param { string } [ type ]
   * @returns { string }
   */
  getcodec( pt, type = "audio" ) {
    return this.#pt2name[ type ][ pt ]
  }

  /***
   * @param { string } name
   * @param { string } [ type ]
   * @returns { string }
   */
  getpt( name, type = "audio" ) {
    return this.#name2pt[ type ][ name ]
  }

  /**
   * Is it one of our supported codecs
   * @param { string } name
   * @param { string } [ type ]
   * @returns { boolean }
   */
  hascodec( name, type = "audio" ) {
    return ( name in this.#name2pt[ type ] )
  }

  /**
   *
   * @param { string } pt
   * @param { string } [ type ]
   * @returns { boolean }
   */
  haspt( pt, type = "audio" ) {
    return ( pt in this.#pt2name[ type ] )
  }

  /**
   * @returns { object }
   */
  get def() {
    return this.#defs
  }

  static create() {
    return new codecconv()
  }
}


function defaultaudiomedia() {
  return {
    "rtp": [],
    "fmtp": [],
    "type": "audio",
    "port": 0,
    "protocol": "RTP/AVP",
    "payloads": [],
    "ptime": 20,
    "direction": "sendrecv"
  }
}

/**
 * Video m-line skeleton. No ptime - it is meaningless for video (frames,
 * not fixed-duration packets) and the clock is 90kHz per the rtp entries.
 * @returns { object }
 */
function defaultvideomedia() {
  return {
    "rtp": [],
    "fmtp": [],
    "type": "video",
    "port": 0,
    "protocol": "RTP/AVP",
    "payloads": [],
    "direction": "sendrecv"
  }
}

/**
 * 
 * @param { object } audio 
 * @param { number } pt 
 * @returns { string }
 */
function getconfigforpt( audio, pt ) {
  for( const fmtp of ( audio.fmtp || [] ) ) {
    if( pt == fmtp.payload ) return fmtp.config
  }
  return ""
}

/* RFC 6184 table 5 as [ profile_idc, profile-iop mask, value, rank ], first
   match wins; the mask covers the low nibble, which must be 0 */
const h264profiles = [
  [ "42", 0x4f, 0x40, 2 ], /* x1xx0000 constrained baseline */
  [ "4d", 0x8f, 0x80, 2 ], /* 1xxx0000 constrained baseline */
  [ "58", 0xcf, 0xc0, 2 ], /* 11xx0000 constrained baseline */
  [ "42", 0x4f, 0x00, 1 ], /* x0xx0000 baseline */
  [ "58", 0xcf, 0x80, 1 ] /* 10xx0000 baseline */
]

/**
 * How well an offered h264 payload suits the relay: 2 = constrained baseline,
 * 1 = baseline, 0 = not relayable. The relay cannot transcode and the leg we
 * offer to always gets our registry h264 (42e01f;packetization-mode=1), so
 * the leg we answer must send and receive a stream that side can decode:
 * - packetization-mode must be 1. A mode-0 receiver cannot take the FU-A
 *   fragments our mode-1 leg sends.
 * - the profile must be (constrained) baseline. High (64xxxx) or Main (4dxxxx)
 *   streams need tools a constrained-baseline decoder does not have.
 * Constrained baseline per RFC 6184 table 5 (profile_idc + profile-iop):
 * 42 with constraint_set1 (x1xx0000, e.g. 42e0/42c0/4240), 4d with
 * constraint_set0 (1xxx0000, e.g. 4d80/4de0) and 58 with constraint_set0 and
 * constraint_set1 (11xx0000). Main with only constraint_set1 (4d40xx) is still
 * Main. Plain baseline (42 x0xx0000, 58 10xx0000) is relayable at lower
 * preference: browser encoders never use the baseline-only tools (FMO/ASO),
 * so its streams and constrained-baseline streams interwork in practice.
 * RFC 6184 defaults: no profile-level-id means 42000a, no packetization-mode
 * means 0.
 * @param { object } om - the offered video m-line
 * @param { object } r - one of its rtp entries
 * @returns { number }
 */
function h264rank( om, r ) {
  const config = getconfigforpt( om, r.payload ).toLowerCase()
  if( !/(^|;)\s*packetization-mode=1\s*(;|$)/.test( config ) ) return 0

  const plid = config.match( /profile-level-id=([0-9a-f]{6})/ )
  const profile = plid? plid[ 1 ]: "42000a"
  const idc = profile.substring( 0, 2 )
  const iop = parseInt( profile.substring( 2, 4 ), 16 )

  const match = h264profiles.find( ( [ pidc, mask, value ] ) => pidc === idc && value === ( iop & mask ) )
  return match? match[ 3 ]: 0
}

/**
 * The best relayable h264 rtp entry of an offered video m-line (see
 * h264rank); ties keep the offerer's order. undefined when none of its h264
 * payloads is relayable (High only, packetization-mode=0 only ...).
 * @param { object } om
 * @returns { object | undefined }
 */
function besth264( om ) {
  let best, bestrank = 0
  for( const r of om.rtp ) {
    if( "h264" !== r.codec.toLowerCase() ) continue
    const rank = h264rank( om, r )
    if( rank > bestrank ) {
      best = r
      bestrank = rank
    }
  }
  return best
}

/**
 * fmtp parameters by which an SDP's author declares what it can RECEIVE
 * beyond its level: h264's max-mbps, max-smbps, max-fs, max-cpb, max-dpb,
 * max-br, max-recv-level (a receive level above profile-level-id under level
 * asymmetry) and max-rcmd-nalu-size (RFC 6184), and vp8's max-fr and max-fs
 * (RFC 7741).
 */
const receivercaps = [ "max-mbps", "max-smbps", "max-fs", "max-cpb", "max-dpb", "max-br", "max-fr",
  "max-recv-level", "max-rcmd-nalu-size" ]

/**
 * An offerer's fmtp config with its receive capabilities (receivercaps) and
 * its sprop-* parameters (sprop-parameter-sets, sprop-level-parameter-sets
 * ... - the offerer's own SPS/PPS and stream properties) removed, for
 * mirroring into our answer: there they would describe what WE receive and
 * send, and the relay hands us the other leg's stream, which was never held
 * to what this offerer claims to decode nor encoded with its parameter sets.
 * The level (profile-level-id) and packetization-mode stay, and caph264level
 * caps the level.
 * @param { string } config
 * @returns { string }
 */
function stripreceivercaps( config ) {
  return config.split( ";" )
    .filter( ( p ) => {
      const name = p.split( "=" )[ 0 ].trim().toLowerCase()
      return !receivercaps.includes( name ) && !name.startsWith( "sprop-" )
    } )
    .join( ";" )
}

/**
 * Level 1b sits between 1 (level_idc 10) and 1.1 (11) but has no level_idc
 * of its own: RFC 6184 writes it as level_idc 11 with constraint_set3 for
 * Baseline, Main and Extended (e.g. 42f00b), and as level_idc 9 for the
 * others. Levels are compared as h264levelvalue gives them, where 1b is this.
 */
const h264level1b = 10.5

/**
 * The profile_idc values for which level_idc 11 with constraint_set3 is 1b:
 * Baseline (42), Main (4d) and Extended (58).
 */
const h264set3is1b = [ "42", "4d", "58" ]

/**
 * The comparable level of a profile-level-id: its level_idc (0x1f = 3.1),
 * except that 1b (see h264level1b) reads as h264level1b rather than as 1.1.
 * @param { string } plid - six hex digits
 * @returns { number }
 */
function h264levelvalue( plid ) {
  const idc = plid.substring( 0, 2 ).toLowerCase()
  const iop = parseInt( plid.substring( 2, 4 ), 16 )
  const lvl = parseInt( plid.substring( 4, 6 ), 16 )
  if( 0x09 === lvl ) return h264level1b
  if( 0x0b === lvl && h264set3is1b.includes( idc ) && ( iop & 0x10 ) ) return h264level1b
  return lvl
}

/**
 * profile-level-id plid rewritten to level (an h264levelvalue). For
 * Baseline/Main/Extended, constraint_set3 carries the 1b-ness, so it is set
 * for 1b and cleared otherwise - or level_idc 11 would be read as 1b (and 1b
 * written as a bare 11 would be read as 1.1); other profiles write 1b as 9.
 * @param { string } plid - six hex digits
 * @param { number } level
 * @returns { string }
 */
function seth264level( plid, level ) {
  const idc = plid.substring( 0, 2 )
  let iop = parseInt( plid.substring( 2, 4 ), 16 )
  let lvl = level
  if( h264set3is1b.includes( idc.toLowerCase() ) ) {
    iop = h264level1b === level? ( iop | 0x10 ): ( iop & ~0x10 )
    if( h264level1b === level ) lvl = 0x0b
  } else if( h264level1b === level ) {
    lvl = 0x09
  }
  return idc + iop.toString( 16 ).padStart( 2, "0" ) + lvl.toString( 16 ).padStart( 2, "0" )
}

/**
 * The h264 level (a level_idc, e.g. 0x1f = 3.1, or h264level1b for 1b; see
 * h264levelvalue) an m-line declares for the h264
 * payload the relay would use from it - besth264, else its first h264 (an
 * answer to our offer carries only our payload) - or undefined when it
 * declares none: no h264, or no profile-level-id. Answers commonly omit
 * a=fmtp altogether, so a missing profile-level-id is read as "not declared"
 * rather than RFC 6184's 42000a, which would needlessly drop the pair to
 * level 1.
 * @param { object } om - a video m-line
 * @returns { number | undefined }
 */
function h264levelof( om ) {
  if( !om || !Array.isArray( om.rtp ) || 0 === om.port ) return
  const r = besth264( om ) || om.rtp.find( ( e ) => "h264" === e.codec.toLowerCase() )
  if( !r ) return
  const plid = getconfigforpt( om, r.payload ).toLowerCase().match( /profile-level-id=([0-9a-f]{6})/ )
  if( !plid ) return
  return h264levelvalue( plid[ 1 ] )
}

/**
 * H.264 levels (ITU-T H.264 Table A-1) as [ level (see h264levelvalue),
 * MaxMBPS (macroblocks/s), MaxFS (macroblocks) ], ascending. Used to find
 * the highest level whose frame size and macroblock rate fit our video
 * limits (see h264levelforlimits) - a level caps both, and RFC 6184's
 * max-fs/max-mbps can only RAISE a receiver's capability above its level,
 * never lower it, so lowering the level is the only way to ask for less.
 */
const h264levels = [
  [ 0x0a, 1485, 99 ],
  [ h264level1b, 1485, 99 ],
  [ 0x0b, 3000, 396 ],
  [ 0x0c, 6000, 396 ],
  [ 0x0d, 11880, 396 ],
  [ 0x14, 11880, 396 ],
  [ 0x15, 19800, 792 ],
  [ 0x16, 20250, 1620 ],
  [ 0x1e, 40500, 1620 ],
  [ 0x1f, 108000, 3600 ],
  [ 0x20, 216000, 5120 ],
  [ 0x28, 245760, 8192 ],
  [ 0x29, 245760, 8192 ],
  [ 0x2a, 522240, 8704 ],
  [ 0x32, 589824, 22080 ],
  [ 0x33, 983040, 36864 ],
  [ 0x34, 2073600, 36864 ]
]

/**
 * H.264 level 1's MaxFS: the smallest frame any level declares. A video
 * limit below it cannot be expressed to an H.264 sender, so setvideolimits
 * raises maxfs to it (and the callmanager raises the relay's maxfs to match).
 */
const h264minfs = h264levels[ 0 ][ 2 ]

/**
 * The Table A-1 row for a level (the highest row at or below it, so an
 * unlisted level_idc reads as the level beneath it).
 * @param { number } level
 * @returns { { mbps: number, fs: number } }
 */
function h264levelrow( level ) {
  let row = h264levels[ 0 ]
  for( const r of h264levels ) {
    if( r[ 0 ] <= level ) row = r
  }
  return { "mbps": row[ 1 ], "fs": row[ 2 ] }
}

/**
 * The highest H.264 level whose MaxFS is within maxfs and whose MaxMBPS is
 * within maxfs * framerate - the most a relay leg enforcing those limits can
 * carry - or undefined when the limits do not bound the frame size at all
 * (maxfs 0 = unlimited). Bitrate plays no part: b=AS/b=TIAS carry it, and
 * letting it pick the level would drop the default 2 Mbps to level 2
 * (352x288). Level 1b is never chosen - it shares level 1's MaxFS/MaxMBPS
 * and only complicates the profile-level-id. The defaults (3600 MB at 30
 * fps = 108000 MB/s) are exactly level 3.1, our registry's level. Below
 * level 1 there is nothing to choose, so a maxfs under 99 still gets level
 * 1 - setvideolimits raises such a maxfs to 99 first (h264minfs) so that
 * level 1 is exactly the limit rather than more than it.
 * @param { number } [ maxfs ] - macroblocks, 0/absent = unlimited
 * @param { number } [ framerate ] - fps, 0/absent = unlimited
 * @returns { number | undefined }
 */
function h264levelforlimits( maxfs, framerate ) {
  if( !( 0 < maxfs ) ) return
  const mbps = ( 0 < framerate )? maxfs * framerate: Infinity
  let best = h264levels[ 0 ][ 0 ]
  for( const [ level, maxmbps, fs ] of h264levels ) {
    if( h264level1b === level ) continue
    if( fs <= maxfs && maxmbps <= mbps ) best = level
  }
  return best
}

/**
 * The share of the relay's enforced bitrate cap we advertise as b=TIAS
 * (RFC 3890): the media bitrate, no IP/UDP/RTP overhead, which is what
 * libwebrtc and Firefox feed their encoders as the max send bitrate. The
 * remaining 15% is headroom for what the relay counts but the encoder does
 * not budget for: RTP/SRTP headers (~2-4% on ~1100-byte video packets),
 * NACK retransmissions (as much as the loss rate, a few % on a poor link)
 * and rate-control overshoot. Keyframe spikes are the relay's burst
 * bucket's job (1 s of bitrate by default), not this margin's.
 */
const tiasfraction = 0.85

/**
 * The share of the cap we advertise as b=AS (RFC 8866, kbps). AS is read as
 * including packet overhead, so it sits 5 points above TIAS to cover the
 * headers and still leaves 10% under the cap for retransmissions and
 * overshoot - for an endpoint that honours only AS (many SIP phones). We
 * write AS first and TIAS last: libwebrtc keeps whichever b= line it reads
 * last, so a browser uses TIAS.
 */
const asfraction = 0.9

/**
 * An fmtp config rewritten: the parameters named in drop removed (whatever
 * their case), then add appended. On m-line m's fmtp for payload pt - a new
 * fmtp entry when there is none and add is not empty, and the entry removed
 * when nothing is left. Entries are replaced, never edited: one may be our
 * codec registry's shared def.
 * @param { object } m - a media section
 * @param { number | string } pt
 * @param { Array< string > } drop
 * @param { Array< string > } add - "name=value" strings
 */
function rewritefmtp( m, pt, drop, add ) {
  if( !Array.isArray( m.fmtp ) ) m.fmtp = []
  const i = m.fmtp.findIndex( ( f ) => String( f.payload ) === String( pt ) )
  const base = -1 === i? "": m.fmtp[ i ].config
  const params = base.split( ";" )
    .map( ( p ) => p.trim() )
    .filter( ( p ) => "" !== p && !drop.includes( p.split( "=" )[ 0 ].trim().toLowerCase() ) )
    .concat( add )
  const config = params.join( ";" )

  if( -1 === i ) {
    if( "" !== config ) m.fmtp.push( { "payload": Number( pt ), config } )
  } else if( "" === config ) {
    m.fmtp.splice( i, 1 )
  } else {
    m.fmtp[ i ] = { ...m.fmtp[ i ], config }
  }
}

/**
 * Can the relay carry this offered rtp entry: vp8, or an h264 payload
 * h264rank accepts.
 * @param { object } om - the offered video m-line
 * @param { object } r - one of its rtp entries
 * @returns { boolean }
 */
function isrelayable( om, r ) {
  const c = r.codec.toLowerCase()
  if( "vp8" === c ) return true
  return "h264" === c && 0 < h264rank( om, r )
}

/**
 * Pick the video codec to accept from a video m-line. When the relay has
 * fixed a common codec, accept only that; otherwise the first of the offer's
 * relayable video codecs wins. Where that codec is h264 the offerer's payload
 * for it is chosen by profile (besth264), not position - Safari lists High
 * (640c1f) first. An offer whose only h264 is not relayable falls to its vp8,
 * or yields undefined (video is then rejected).
 *
 * An ANSWER to our offer is different: it can only carry payload types we
 * offered, with our fmtp (packetization-mode must match per RFC 6184, and
 * answers commonly omit a=fmtp), so there the first matching codec is taken
 * as it stands.
 * @param { object } om - the offered (or answering) video m-line
 * @param { string } [ wanted ] - "vp8"/"h264"
 * @param { boolean } [ answer ] - om is an answer to our offer
 * @returns { object | undefined } - the chosen rtp entry
 */
function choosevideocodec( om, wanted, answer = false ) {
  if( !Array.isArray( om.rtp ) ) return
  if( answer ) {
    return om.rtp.find( ( r ) => {
      const c = r.codec.toLowerCase()
      if( wanted ) return c === wanted
      return "vp8" === c || "h264" === c
    } )
  }

  const first = om.rtp.find( ( r ) =>
    ( !wanted || r.codec.toLowerCase() === wanted ) && isrelayable( om, r ) )

  if( first && "h264" === first.codec.toLowerCase() ) return besth264( om )
  return first
}

/**
 * The relayable video codec names ("vp8"/"h264") of an offered video m-line,
 * in its order, de-duplicated. Empty when the m-line is disabled (port 0).
 * @param { object } om
 * @returns { Array< string > }
 */
function relayablevideocodecs( om ) {
  const names = []
  if( !om || !Array.isArray( om.rtp ) || 0 === om.port ) return names
  for( const r of om.rtp ) {
    const c = r.codec.toLowerCase()
    if( !names.includes( c ) && isrelayable( om, r ) ) names.push( c )
  }
  return names
}

/**
 * The video m-line the relay carries from an SDP's media list: the first
 * live (port != 0) video m-line with a codec choosevideocodec would take. An
 * offer may carry several video m-lines (a second camera, a screen share) or
 * a disabled one; a relay leg carries exactly one, and the answer
 * (mirrormedia) and the relay target (call.js) must agree on which.
 * @param { Array< object > } media
 * @param { string } [ wanted ]
 * @param { boolean } [ answer ]
 * @returns { object | undefined }
 */
function relayvideomedia( media, wanted, answer = false ) {
  return media.find( ( om ) => "video" === om.type && 0 !== om.port &&
    !!choosevideocodec( om, wanted, answer ) )
}

/**
 * The direction an answer gives a stream offered with `direction` (RFC 3264
 * 6.1): sendonly is answered recvonly, recvonly sendonly, inactive inactive,
 * anything else sendrecv.
 * @param { string } [ direction ]
 * @returns { "sendrecv" | "sendonly" | "recvonly" | "inactive" }
 */
function mirrordirection( direction ) {
  switch( direction ) {
  case "sendonly": return "recvonly"
  case "recvonly": return "sendonly"
  case "inactive": return "inactive"
  default: return "sendrecv"
  }
}

/**
 * The per-m-line transport attributes our webrtc decorators write (addssrc,
 * secure, addicecandidates, rtcpmux). A re-answer rebuilds the video m-line
 * from the new offer but carries these over from the m-line it replaces, so
 * the same relay leg keeps its ice credentials and ssrc (new ones would read
 * as an ICE restart).
 */
const transportattrs = [ "candidates", "iceUfrag", "icePwd", "fingerprint", "setup", "ssrcs", "msid", "rtcpMux" ]

/**
 * An answer's m-line rejecting the offered m-line om: port 0, its format list
 * echoed (RFC 3264 requires one), its mid kept.
 * @param { object } om
 * @returns { object }
 */
function rejectedmedia( om ) {
  const rejected = {
    "rtp": [],
    "fmtp": [],
    "type": om.type,
    "port": 0,
    "protocol": om.protocol,
    "payloads": Array.isArray( om.payloads )? [ ...om.payloads ]: [ om.payloads ],
    "direction": "inactive"
  }
  // @ts-ignore
  if( undefined !== om.mid ) rejected.mid = om.mid
  return rejected
}

/**
 * An answer's m-line accepting the offered video m-line om with the codec
 * `chosen` on our port. See mirrormedia.
 * @param { object } om
 * @param { object } chosen - the rtp entry of om we accept
 * @param { number } port
 * @param { object } [ previous ] - our m-line this one replaces (a re-answer)
 * @returns { object }
 */
function acceptedvideo( om, chosen, port, previous ) {
  const v = defaultvideomedia()
  v.port = port
  v.protocol = om.protocol
  v.rtp = [ { ...chosen } ]
  v.fmtp = om.fmtp
    .filter( ( f ) => f.payload === chosen.payload )
    .map( ( f ) => ( { ...f, "config": stripreceivercaps( f.config ) } ) )
    .filter( ( f ) => "" !== f.config )
  /* an empty list writes no a=rtcp-fb lines */
  // @ts-ignore
  v.rtcpFb = answerrtcpfb( om, chosen.payload )
  // @ts-ignore
  v.payloads = [ chosen.payload ]
  v.direction = mirrordirection( om.direction )
  // @ts-ignore
  if( undefined !== om.mid ) v.mid = om.mid

  if( previous ) {
    for( const k of transportattrs ) {
      if( undefined !== previous[ k ] ) v[ k ] = previous[ k ]
    }
  }
  return v
}

/**
 * An m-line's format list as an array (toString() writes it back as a
 * string, and a non-rtp m-line such as m=application has one token).
 * @param { object } m
 * @returns { Array< number | string > }
 */
function payloadsof( m ) {
  if( Array.isArray( m.payloads ) ) return [ ...m.payloads ]
  if( undefined === m.payloads || "" === m.payloads ) return []
  return String( m.payloads ).split( /[ ,]+/ )
    .filter( ( p ) => "" !== p )
    .map( ( p ) => ( /^\d+$/.test( p )? Number( p ): p ) )
}

/**
 * RTCP feedback we negotiate on relayed video. projectrtp's relay turns an
 * incoming PLI or FIR into a (rate-limited) PLI toward the source, and passes
 * a generic NACK through to the source translated back to its own SSRC and
 * sequence numbers, so the sending browser retransmits rather than being asked
 * for a keyframe on every loss. Those are all feedback it can honour. Never
 * goog-remb or transport-cc: the relay ignores both and generates neither,
 * so a sender relying on them would starve its bandwidth estimate. No rtx.
 *
 * Likewise no a=extmap on either leg: the relay forwards RTP header
 * extensions verbatim, so both legs would have to negotiate identical IDs
 * per URI, which we cannot guarantee (each far end numbers its own). With
 * none negotiated, browsers send none. Every video m-line we write is built
 * fresh (addcodecs / mirrormedia), so an offer's extmaps never carry over.
 */
const videortcpfb = [
  { "type": "nack" },
  { "type": "nack", "subtype": "pli" },
  { "type": "ccm", "subtype": "fir" }
]

/**
 * Our rtcp-fb lines for one video payload type, in sdp-transform shape.
 * @param { number } pt
 * @returns { Array< object > }
 */
function videortcpfbfor( pt ) {
  return videortcpfb.map( ( f ) => ( { "payload": pt, ...f } ) )
}

/**
 * The subset of an offer's rtcp-fb for payload pt that we support, rewritten
 * onto pt (an offer may use the "*" wildcard). RFC 4585: an answer may only
 * carry feedback the offer offered for that payload.
 * @param { object } om - the offered m-line
 * @param { number } pt
 * @returns { Array< object > }
 */
function answerrtcpfb( om, pt ) {
  // @ts-ignore
  const offered = ( om.rtcpFb || [] ).filter( ( f ) => "*" === f.payload || String( pt ) === String( f.payload ) )
  return videortcpfb
    .filter( ( ours ) => offered.some( ( f ) => ours.type === f.type && ours.subtype === f.subtype ) )
    .map( ( f ) => ( { "payload": pt, ...f } ) )
}

/**
 * b=AS then b=TIAS for bitrate (see asfraction/tiasfraction) on media m,
 * replacing any AS/TIAS already there; none when bitrate is 0 (unlimited).
 * @param { object } m
 * @param { number } bitrate - the relay's cap, bits/s
 */
function setvideobandwidth( m, bitrate ) {
  const bandwidth = ( m.bandwidth || [] ).filter( ( b ) => "AS" !== b.type && "TIAS" !== b.type )
  if( 0 < bitrate ) {
    bandwidth.push( { "type": "AS", "limit": Math.max( 1, Math.floor( bitrate * asfraction / 1000 ) ) } )
    bandwidth.push( { "type": "TIAS", "limit": Math.max( 1, Math.floor( bitrate * tiasfraction ) ) } )
  }
  if( 0 < bandwidth.length ) m.bandwidth = bandwidth
  else delete m.bandwidth
}

/**
 * The VP8 payload pt's fmtp on m carries our max-fs and max-fr (RFC 7741).
 * @param { object } m
 * @param { number } pt
 * @param { { maxfs: number, framerate: number } } l
 */
function setvp8limits( m, pt, l ) {
  const add = []
  if( 0 < l.maxfs ) add.push( "max-fs=" + l.maxfs )
  if( 0 < l.framerate ) add.push( "max-fr=" + l.framerate )
  rewritefmtp( m, pt, [ "max-fs", "max-fr" ], add )
}

/**
 * The H.264 payload pt's level on m lowered to l.h264level when it declares
 * more (see sdp.setvideolimits), with max-fs/max-mbps raising it back up to
 * the limits but never past the level it declared before.
 * @param { object } m
 * @param { number } pt
 * @param { { maxfs: number, framerate: number, h264level: number | undefined } } l
 */
function seth264limits( m, pt, l ) {
  if( undefined === l.h264level ) return
  const plid = getconfigforpt( m, pt ).match( /profile-level-id=([0-9a-fA-F]{6})/ )
  if( !plid ) return
  const declared = h264levelvalue( plid[ 1 ] )
  if( declared <= l.h264level ) return

  const ceiling = h264levelrow( declared )
  const floor = h264levelrow( l.h264level )
  const fs = Math.min( l.maxfs, ceiling.fs )
  const mbps = Math.min( ( 0 < l.framerate )? l.maxfs * l.framerate: Infinity, ceiling.mbps )
  const add = []
  if( fs > floor.fs ) add.push( "max-fs=" + fs )
  if( mbps > floor.mbps ) add.push( "max-mbps=" + mbps )

  /* the level rewritten in place, then our max-fs/max-mbps */
  const level = "profile-level-id=" + seth264level( plid[ 1 ], l.h264level )
  m.fmtp = m.fmtp.map( ( f ) => ( String( f.payload ) !== String( pt ) )? f:
    { ...f, "config": f.config.replace( plid[ 0 ], level ) } )
  rewritefmtp( m, pt, [ "max-fs", "max-mbps" ], add )
}

/**
 * Our video limits on one live video media section: see sdp.setvideolimits.
 * @param { object } m
 * @param { { bitrate: number, maxfs: number, framerate: number, h264level: number | undefined } } l
 */
function limitvideomedia( m, l ) {
  setvideobandwidth( m, l.bitrate )

  if( 0 < l.framerate ) m.framerate = l.framerate
  else delete m.framerate

  for( const r of ( m.rtp || [] ) ) {
    const codec = r.codec.toLowerCase()
    if( "vp8" === codec ) setvp8limits( m, r.payload, l )
    else if( "h264" === codec ) seth264limits( m, r.payload, l )
  }
}

class sdp {

  #dynamicpts
  /* codec selection is per media type - a whole-SDP scalar meant the
     toString() filter clobbered every other m-line's payloads */
  #selected = {}

  constructor( sdp ) {

    /* defaults inc. static */
    this.#dynamicpts = codecconv.create()

    if ( undefined === sdp ) {
      sessionidcounter = ( sessionidcounter + 1 ) % 4294967296

      this.sdp = {
        version: 0,
        origin: {
          username: "-",
          sessionId: sessionidcounter,
          sessionVersion: 0,
          netType: "IN",
          ipVer: 4,
          address: "127.0.0.1"
        },
        name: "project",
        timing: {
          start: 0,
          stop: 0
        },
        connection: {
          version: 4,
          ip: "127.0.0.1"
        },
        //iceUfrag: 'F7gI',
        //icePwd: 'x9cml/YzichV2+XlhiMu8g',
        //fingerprint:
        // { type: 'sha-1',
        //   hash: '42:89:c5:c6:55:9d:6e:c8:e8:83:55:2a:39:f9:b6:eb:e9:a3:a9:e7' },
        media: [ {
          rtp: [],
          fmtp: [],
          type: "audio",
          port: 0,
          protocol: "RTP/AVP",
          payloads: [],
          ptime: 20,
          direction: "sendrecv"
        } ]
      }
    } else {

      this.sdp = sdptransform.parse( sdp )

      /* Convert payloads to something more consistent. Always an array of Numbers */
      this.sdp.media.forEach( ( media, i, a ) => {

        if ( "audio" === media.type ) {
          if ( "string" === typeof media.payloads ) {
            // @ts-ignore
            media.payloads = media.payloads.split( /[ ,]+/ )
          }

          if ( !Array.isArray( media.payloads ) ) {
            // @ts-ignore
            a[ i ].payloads = [ media.payloads ]
          }

          // @ts-ignore
          media.payloads.forEach( ( v, vi, va ) => va[ vi ] = Number( v ) )

          /* handle our dynamic payloadtypes */
          media.rtp.forEach( ( m ) => {
            switch( m.codec.toLowerCase() ) {
            case "ilbc": {
              if( 8000 == m.rate ) {
                this.#dynamicpts.setdynamicpt( "ilbc", "ilbc", m.payload )
              }
              return
            }
            case "telephone-event": {
              if( 8000 == m.rate ) {
                this.#dynamicpts.setdynamicpt( "2833", "telephone-event", m.payload )
              }
            }
            }
          } )
        } else if ( "video" === media.type ) {
          if ( "string" === typeof media.payloads ) {
            // @ts-ignore
            media.payloads = media.payloads.split( /[ ,]+/ )
          }

          if ( !Array.isArray( media.payloads ) ) {
            // @ts-ignore
            a[ i ].payloads = [ media.payloads ]
          }

          // @ts-ignore
          media.payloads.forEach( ( v, vi, va ) => va[ vi ] = Number( v ) )

          /* register the offerer's video PTs - first vp8 entry wins; for
             h264 (browsers list several PTs for different profiles) the one
             choosevideocodec would accept, so the registry and the answer
             agree on the payload type (else the first, as before - an
             answer to our offer may omit fmtp) */
          const vp8 = media.rtp.find( ( m ) => "vp8" === m.codec.toLowerCase() )
          if( vp8 ) this.#dynamicpts.setdynamicpt( "vp8", "vp8", vp8.payload, "video" )
          const h264 = besth264( media ) ||
            media.rtp.find( ( m ) => "h264" === m.codec.toLowerCase() )
          if( h264 ) this.#dynamicpts.setdynamicpt( "h264", "h264", h264.payload, "video" )
        }
      } )

    }
  }

  /**
   * Takes a mixed input and outputs an array in the form [ "pcmu", "pcma" ]
   * @param { string | Array<string> } codecarray
   * @return { Array< string >}
   */
  alltocodecname( codecarray ) {

    /* check and convert to array */
    if ( "string" === typeof codecarray ) {
      codecarray = codecarray.split( /[ ,]+/ )
    }

    /* convert to payloads */
    const retval = []
    for( const oin of codecarray ) {
      if( this.#dynamicpts.hascodec( oin ) ) {
        retval.push( oin )
      } else if( this.#dynamicpts.haspt( oin ) ) {
        retval.push( this.#dynamicpts.getcodec( oin ) )
      }
    }

    return retval
  }

  /*
  Used by our rtpchannel to get the port and address information (and codec).
  Ideally we replicate the object required for target in our RTP service.
  */
  getaudio() {
    const m = this.sdp.media.find( mo => "audio" === mo.type )

    if ( m ) {

      let payloads = m.payloads
      if ( this.#selected.audio !== undefined ) {
        payloads = [ this.#selected.audio ]
      }

      let address
      let port = m.port
      // @ts-ignore
      if ( m.candidates ) {
        // @ts-ignore
        for( const c of m.candidates ) {
          /*
          {
            foundation: 842238307,
            component: 1,
            transport: 'udp',
            priority: 2113937151,
            ip: '2dcfedf6-d4e8-4a56-a0b6-efb390be339d.local',
            port: 48245,
            type: 'host',
            generation: 0,
            'network-cost': 999
          }
          */
          if( !c.ip.endsWith( ".local" ) ) {
            address = c.ip
            port = c.port
          }
        }
        /*console.log( m.candidates )*/
      }
      

      if( !address ) {
        if( this.sdp.connection ) address = this.sdp.connection.ip
        else if( this.sdp.origin.address ) address = this.sdp.origin.address
      }
      

      return {
        "port": port,
        "address": address,
        "audio": {
          "payloads": payloads
        }
      }
    }
    return false
  }

  /**
   * The remote video m-line's address and port (its own candidate when it
   * has one - video rides its own transport, so it is not necessarily the
   * audio address/port). Mirror of getaudio for the relay path.
   * @param { object } [ m ] - the video m-line to read (see getrelayvideo),
   *   default the first video m-line
   * @returns { object | false }
   */
  getvideo( m = this.sdp.media.find( mo => "video" === mo.type ) ) {
    if( !m || 0 === m.port ) return false

    let address
    let port = m.port
    // @ts-ignore
    if( m.candidates ) {
      // @ts-ignore
      for( const c of m.candidates ) {
        if( !c.ip.endsWith( ".local" ) ) {
          address = c.ip
          port = c.port
        }
      }
    }

    if( !address ) {
      if( this.sdp.connection ) address = this.sdp.connection.ip
      else if( this.sdp.origin.address ) address = this.sdp.origin.address
    }

    return { "port": port, "address": address }
  }

  /**
   * select works in conjunction with getaudioremote and allows us to force the
   * selection of the codec we send to our RTP server. This is used on the offered SDP.
   * If intersect has been called with firstonly flag set then this has the same effect.
   * @param { string } codec
   */
  select( codec ) {
    if ( isNaN( parseInt( codec ) ) ) {
      if ( undefined === this.#dynamicpts.hascodec( codec ) ) return
      codec = this.#dynamicpts.getpt( codec )
    }
    this.#selected.audio = codec

    return this
  }

  /**
   * @returns { object | undefined }
   * @property { string } name - the name of the codec - i.e. pcma
   * @property { number } pt - the payload type (static) used for prtp
   * @property { number } dpt - the dynamic payload type negotiated for this session
   */
  get selected() {

    if( undefined === this.#selected.audio ) return undefined

    const name = this.#dynamicpts.getcodec( this.#selected.audio )
    return {
      name,
      pt: prtpcodecpts[ name ],
      dpt: this.#selected.audio
    }
  }

  static create( from ) {
    return new sdp( from )
  }

  /**
   * The rtp entry we would accept from an offered video m-line - exposed so
   * call.js points its relay channel at the same payload type the answer
   * (mirrormedia) accepts. See choosevideocodec.
   * @param { object } om
   * @param { string } [ wanted ]
   * @param { boolean } [ answer ] - om answers our offer
   * @returns { object | undefined }
   */
  static choosevideocodec( om, wanted, answer = false ) {
    return choosevideocodec( om, wanted, answer )
  }

  /**
   * The video m-line of this SDP the relay carries: the first live one with
   * a codec we would take (see relayvideomedia) - or undefined when none.
   * @param { string } [ wanted ] - the pinned codec, if any
   * @param { boolean } [ answer ] - this SDP answers our offer
   * @returns { object | undefined }
   */
  getrelayvideo( wanted, answer = false ) {
    return relayvideomedia( this.sdp.media, wanted, answer )
  }

  /**
   * See mirrordirection.
   * @param { string } [ direction ]
   * @returns { string }
   */
  static mirrordirection( direction ) {
    return mirrordirection( direction )
  }

  /**
   * The video codec names the relay can carry from an offered video m-line.
   * See relayablevideocodecs.
   * @param { object } om
   * @returns { Array< string > }
   */
  static relayablevideocodecs( om ) {
    return relayablevideocodecs( om )
  }

  /**
   * The h264 level an m-line declares (see h264levelof): its level_idc,
   * or sdp.h264level1b for level 1b.
   * @param { object } om
   * @returns { number | undefined }
   */
  static h264level( om ) {
    return h264levelof( om )
  }

  /**
   * Level 1b as h264level reports it (see h264level1b).
   * @returns { number }
   */
  static get h264level1b() {
    return h264level1b
  }

  /**
   * Lower the level of every h264 profile-level-id on our video m-line to at
   * most maxlevel (a level_idc, e.g. 0x1f). The relay cannot transcode, so
   * each leg must be held to a level the OTHER leg can decode: with
   * level-asymmetry-allowed each side's level is what it will receive, and
   * the relay hands it the other side's stream. Profile (constrained
   * baseline) and packetization-mode are untouched; a level already at or
   * under the cap is left alone. RFC 6184 lets an answerer lower the level.
   * Level 1b (h264level1b, as h264level reports it) is written as RFC 6184
   * spells it for the profile - 42e01f capped to 1b is 42f00b - since a bare
   * level_idc 11 would say 1.1, a level the 1b peer does not decode.
   * @param { number } [ maxlevel ]
   * @returns { sdp }
   */
  caph264level( maxlevel ) {
    if( !maxlevel ) return this
    const m = this.sdp.media.find( ( mo ) => "video" === mo.type )
    if( !m || !Array.isArray( m.fmtp ) ) return this
    const h264pts = ( m.rtp || [] )
      .filter( ( r ) => "h264" === r.codec.toLowerCase() )
      .map( ( r ) => String( r.payload ) )
    m.fmtp = m.fmtp.map( ( f ) => {
      if( !h264pts.includes( String( f.payload ) ) ) return f
      const config = f.config.replace( /profile-level-id=([0-9a-fA-F]{6})/, ( all, plid ) => {
        if( h264levelvalue( plid ) <= maxlevel ) return all
        return "profile-level-id=" + seth264level( plid, maxlevel )
      } )
      /* a copy: the entry may be our codec registry's shared def */
      return { ...f, config }
    } )
    return this
  }

  /**
   * Advertise our own video receive limits on every live (port != 0) video
   * m-line - what the projectrtp relay leg behind it enforces (relaylimits).
   * Nothing here is the offerer's: stripreceivercaps has already removed the
   * offerer's max-fs/max-fr/max-mbps from a mirrored answer, and these are
   * ours, added deliberately afterwards. Written on offers, answers,
   * re-offers and re-answers alike (both relay legs enforce, so staff and
   * guest are both told); a hold keeps them, as it only changes the
   * direction. Idempotent.
   *
   * What each line achieves depends on the sender. The bitrate lines are the
   * reliable part: libwebrtc (Chrome, Safari) and Firefox cap their send
   * bitrate to b=TIAS / b=AS. The resolution and frame-rate lines are
   * advisory: valid SDP, honoured by some SIP endpoints, but libwebrtc
   * ignores VP8 max-fs/max-fr when sending and never parses a=framerate. The
   * relay's relaylimits are the enforcement, and a browser client must cap
   * its own capture/encoder (resolution and frame rate) to stay under them.
   *
   * - bitrate: b=AS (kbps, asfraction of the cap) then b=TIAS (bps,
   *   tiasfraction of the cap) - just under the cap, see those.
   * - framerate: a=framerate (RFC 8866 - H.264 has no fmtp for it).
   * - VP8: fmtp max-fs and max-fr (RFC 7741).
   * - H.264: a level above what maxfs/framerate allow (h264levelforlimits)
   *   is lowered to it - RFC 6184 max-fs/max-mbps may only raise a
   *   receiver's capability above its level - and then max-fs/max-mbps
   *   raise it back up to the limits, never beyond the level the m-line
   *   declared before (caph264level's ceiling: what the other leg decodes).
   *   A level already at or under the limits is left alone, so the defaults
   *   (exactly level 3.1) leave our registry's 42e01f untouched.
   * A limit of 0 (or absent) is unlimited and writes nothing. Values are
   * rounded down to whole numbers, and a maxfs of 1-98 is raised to 99
   * (h264minfs): no H.264 level declares a smaller frame, so a smaller limit
   * could not be advertised consistently - the callmanager applies the same
   * floor to the relay's limit.
   * @param { object } [ limits ]
   * @param { number } [ limits.bitrate ] - bits/s the relay enforces
   * @param { number } [ limits.framerate ] - frames/s
   * @param { number } [ limits.maxfs ] - frame size in 16x16 macroblocks
   * @returns { sdp }
   */
  setvideolimits( limits ) {
    if( !limits ) return this
    const whole = ( v ) => {
      const n = Math.floor( Number( v ) )
      return ( Number.isFinite( n ) && 0 < n )? n: 0
    }
    const l = {
      "bitrate": whole( limits.bitrate ),
      "framerate": whole( limits.framerate ),
      "maxfs": whole( limits.maxfs )
    }
    if( 0 < l.maxfs && h264minfs > l.maxfs ) l.maxfs = h264minfs
    l.h264level = h264levelforlimits( l.maxfs, l.framerate )

    for( const m of this.sdp.media ) {
      if( "video" !== m.type || 0 === m.port ) continue
      limitvideomedia( m, l )
    }
    return this
  }

  /**
   * The highest H.264 level video limits allow (see h264levelforlimits),
   * or undefined when they do not bound the frame size.
   * @param { number } [ maxfs ]
   * @param { number } [ framerate ]
   * @returns { number | undefined }
   */
  static h264levelforlimits( maxfs, framerate ) {
    return h264levelforlimits( maxfs, framerate )
  }

  setsessionid( i ) {
    this.sdp.origin.sessionId = i
    return this
  }

  setconnectionaddress( addr ) {
    this.sdp.connection.ip = addr
    return this
  }

  setoriginaddress( addr ) {
    this.sdp.origin.address = addr
    return this
  }

  setaudioport( port ) {
    this.getmedia().port = port
    return this
  }

  /**
   * Set the port on the video m-line (offer path). No-op when there is no
   * video m-line, so callers need not guard.
   * @param { number } port
   */
  setvideoport( port ) {
    const m = this.getmedia( "video" )
    if( m ) m.port = port
    return this
  }

  /**
   * Find the m-line of the given type. Auto-creates a missing AUDIO m-line
   * (long-standing behaviour many callers lean on); any other type returns
   * undefined rather than appending an audio m-line to a video request,
   * which is what the old unconditional defaultaudiomedia() push did.
   * @param { string } type
   * @returns { object | undefined }
   */
  getmedia( type = "audio" ) {
    let m = this.sdp.media.find( mo => type === mo.type )
    if ( !m && "audio" === type ) {
      // @ts-ignore
      this.sdp.media.push( defaultaudiomedia() )
      m = this.sdp.media[ this.sdp.media.length - 1 ]
    }

    return m
  }

  /**
   * Like getmedia but creates the correctly-typed m-line when absent.
   * @param { string } type
   * @returns { object }
   */
  #ensuremedia( type = "audio" ) {
    let m = this.getmedia( type )
    if ( !m ) {
      // @ts-ignore
      this.sdp.media.push( "video" === type ? defaultvideomedia() : defaultaudiomedia() )
      m = this.sdp.media[ this.sdp.media.length - 1 ]
    }
    return m
  }

  /**
   * 
   * @param { "sendrecv"|"inactive"|"sendonly"|"recvonly" } direction 
   * @returns { object }
   */
  setaudiodirection( direction ) {
    this.getmedia().direction = direction
    return this
  }

  /**
   * Set the direction of our live (port != 0) video m-line(s); a rejected
   * m-line stays inactive. No-op without video.
   * @param { "sendrecv"|"inactive"|"sendonly"|"recvonly" } direction
   * @returns { object }
   */
  setvideodirection( direction ) {
    for( const m of this.sdp.media ) {
      if( "video" === m.type && 0 !== m.port ) m.direction = direction
    }
    return this
  }

  /** 
   * Add a CODEC or CODECs, formats:
   * "pcma"
   * "pcma pcmu"
   * "pcma, pcmu"
   * [ "pcma", pcmu ]
   * @param { string | Array< string > } codecs
   */
  addcodecs( codecs ) {
    let codecarr = codecs
    if ( !Array.isArray( codecarr ) && "string" === typeof codecs ) {
      codecarr = codecs.split( /[ ,]+/ )
    } else {
      codecarr = []
    }

    codecarr.forEach( codec => {
      const codecn = this.#dynamicpts.getpt( codec )
      const def = this.#dynamicpts.def.rtp[ codec ]
      if ( undefined !== def ) {
        /* suported audio */
        const m = this.#ensuremedia( this.#dynamicpts.def.type[ codec ] )

        /* Don't allow duplicates */
        if( m.payloads.includes( codecn ) ) return

        m.rtp.push( def )
        // @ts-ignore
        m.payloads.push( def.payload )

        if ( undefined !== this.#dynamicpts.def.fmtp[ codec ] ) {
          m.fmtp.push( this.#dynamicpts.def.fmtp[ codec ] )
        }

        /* offer nack / nack pli / ccm fir on every video codec we offer */
        if ( "video" === m.type ) {
          // @ts-ignore
          m.rtcpFb = ( m.rtcpFb || [] ).concat( videortcpfbfor( def.payload ) )
        }
      }
    } )

    return this
  }

  /**
   * RFC 3264: an answer's m-line list must mirror the offer's - same count,
   * same order. Reshape this (answer) SDP to match: our audio m-line slots
   * into the offer's (first) audio position; the offer's relay video m-line
   * (the first live one with a codec we can relay, see relayvideomedia) is
   * accepted when options.videoport is a real port - mirroring the
   * offerer's own payload type and fmtp for the codec chosen, less the
   * offerer's receive capabilities such as max-fs/max-mbps/max-br (see
   * stripreceivercaps), with its direction mirrored (RFC 3264 6.1).
   * Everything else - a second video m-line (screen share), an m-line the
   * offerer disabled with port 0 (RFC 3264 6), a second audio m-line, any
   * other media type - is rejected with port 0 and its format list echoed.
   * Offer mids are copied through so a BUNDLE-aware offerer can correlate.
   *
   * On a re-answer (this SDP already answered or offered in the dialog) our
   * audio m-line is kept as it is, and an accepted video m-line keeps the
   * transport (ice, ssrc, fingerprint) of our live video m-line on the same
   * port.
   * @param { sdp } offer - the parsed remote offer
   * @param { object } [ options ]
   * @param { number } [ options.videoport ] - local port to accept video on; 0/absent rejects
   * @param { string } [ options.videocodec ] - when set ("vp8"/"h264"), accept
   *   ONLY this codec from the offer's video m-line (relay legs must agree on
   *   one codec); absent keeps the legacy "first codec we know" behaviour
   */
  mirrormedia( offer, options = {} ) {

    const previous = this.sdp.media
    const ouraudio = previous.find( ( m ) => "audio" === m.type )
    const ourvideo = previous.find( ( m ) => "video" === m.type && 0 !== m.port && m.port === options.videoport )
    const relayvideo = options.videoport?
      relayvideomedia( offer.sdp.media, options.videocodec ): undefined
    let audioslotted = false

    const ordered = []
    for( const om of offer.sdp.media ) {

      if( "audio" === om.type && !audioslotted ) {
        audioslotted = true
        let ours = ouraudio
        if( !ours ) {
          ours = defaultaudiomedia()
          // @ts-ignore
          ours.payloads = [ ...om.payloads ]
        }
        // @ts-ignore
        if( undefined !== om.mid ) ours.mid = om.mid
        ordered.push( ours )
      } else if( om === relayvideo ) {
        /* a session-level a=sendonly etc. applies to an m-line without its own */
        // @ts-ignore
        const direction = om.direction || offer.sdp.direction
        ordered.push( acceptedvideo( { ...om, direction }, choosevideocodec( om, options.videocodec ), options.videoport, ourvideo ) )
      } else {
        ordered.push( rejectedmedia( om ) )
      }
    }

    this.sdp.media = ordered
    return this
  }

  /**
   * RFC 3264 8.1: a re-offer must carry every m-line the session has had, in
   * the same order (a stream is disabled with port 0, never removed), and
   * browsers reject one that does not. Reshape this freshly built re-offer
   * against the previous local SDP of the dialog (which by the same rule
   * holds every m-line so far): each of our m-lines takes the old slot of its
   * type - preferring a slot that was live - and its mid; an old slot we no
   * longer carry (a video leg that idle-closed, an m-line we rejected) is
   * kept disabled with port 0; an m-line of ours with no old slot is appended.
   * The origin keeps its session id and bumps its version (RFC 3264 8).
   * @param { sdp } [ previous ] - our previous local SDP in this dialog
   * @returns { sdp }
   */
  preservemlines( previous ) {
    if( !previous || !previous.sdp || !Array.isArray( previous.sdp.media ) ) return this

    const old = previous.sdp.media
    const slots = new Array( old.length )
    const appended = []

    for( const m of this.sdp.media ) {
      const free = ( i, live ) => !slots[ i ] && old[ i ].type === m.type && ( !live || 0 !== old[ i ].port )
      let i = old.findIndex( ( o, n ) => free( n, true ) )
      if( -1 === i ) i = old.findIndex( ( o, n ) => free( n, false ) )
      if( -1 === i ) {
        appended.push( m )
        continue
      }
      // @ts-ignore
      if( undefined !== old[ i ].mid ) m.mid = old[ i ].mid
      slots[ i ] = m
    }

    this.sdp.media = old.map( ( o, i ) => {
      if( slots[ i ] ) return slots[ i ]
      const disabled = rejectedmedia( { ...o, "payloads": payloadsof( o ) } )
      if( 0 === disabled.payloads.length ) disabled.payloads = [ 0 ]
      return disabled
    } ).concat( appended )

    if( previous.sdp.origin ) {
      this.sdp.origin.sessionId = previous.sdp.origin.sessionId
      this.sdp.origin.sessionVersion = Number( previous.sdp.origin.sessionVersion || 0 ) + 1
    }
    return this
  }

  /**
   * Add SSRC to each media entry. This ties together multiple streams in one
   * which will be important when we add video.
   * @param { string | number } ssrc the ssrc for the (audio) streams
   * @param { object } [ permedia ] per-media-type ssrc override, e.g.
   *   { video: 12345 } - used when video rides its own transport/channel and
   *   therefore its own ssrc. Absent → every m-line shares `ssrc` (unchanged).
   */
  addssrc( ssrc, permedia = {} ) {
    // @ts-ignore
    this.sdp.msidSemantic = {
      "semantic": "WMS",
      "token": crypto.randomBytes( 16 ).toString( "hex" )
    }

    for( const m of this.sdp.media ) {
      /* a rejected (port 0) m-line carries no stream */
      if( 0 === m.port ) continue
      const mssrc = ( m.type in permedia )? permedia[ m.type ]: ssrc
      const mmsid = crypto.randomBytes( 16 ).toString( "hex" )
      // @ts-ignore
      m.ssrcs = [
        { "id": mssrc, "attribute": "cname", "value": crypto.randomBytes( 16 ).toString( "hex" ) },
        // @ts-ignore
        { "id": mssrc, "attribute": "msid", "value": this.sdp.msidSemantic.token + " " + mmsid },
        // @ts-ignore
        { "id": mssrc, "attribute": "mslabel", "value": this.sdp.msidSemantic.token },
        { "id": mssrc, "attribute": "label", "value": mmsid }
      ]

      // @ts-ignore
      m.msid = m.ssrcs[ 1 ].value
    }

    return this
  }

  /**
   * Configures the SDP for DTLS (WebRTC).
   * Limitation is it requires the same fingerprint for each connection
   * TODO - seperate each media connection for different fingerprints.
   * @param { string } fingerprint - i.e. "D3:55:21:F4..."
   * @param { string } actpass - "active|passive|actpass"
   */
  secure( fingerprint, actpass ) {
    let count = 0
    for( const m of this.sdp.media ) {
      m.protocol = "UDP/TLS/RTP/SAVPF"
      // @ts-ignore
      m.fingerprint = {
        "type": "sha-256",
        "hash": fingerprint
      }
      // @ts-ignore
      m.setup = actpass

      /* keep a mid mirrored from the offer; only invent one when absent */
      // @ts-ignore
      if( undefined === m.mid ) m.mid = "" + count
      count++
    }

    /* a=group:BUNDLE promises one transport for the listed m-lines, so it
       is only honest when every active m-line shares one port - one
       channel per media type means separate ports, and then the line must
       go. The single-m-line (audio only) case keeps its BUNDLE exactly as
       before. */
    // @ts-ignore
    const active = this.sdp.media.filter( ( m ) => 0 < m.port )
    // @ts-ignore
    const ports = new Set( active.map( ( m ) => m.port ) )

    // @ts-ignore
    this.sdp.groups = this.sdp.groups || []
    // @ts-ignore
    const idx = this.sdp.groups.findIndex(g => "BUNDLE" === g.type)
    if( 1 >= ports.size && 0 < active.length ) {
      // @ts-ignore
      const mids = active.map( ( m ) => m.mid ).join( " " )
      const bundle = { type: "BUNDLE", mids }
      // @ts-ignore
      if (-1 === idx) this.sdp.groups.push( bundle )
      // @ts-ignore
      else this.sdp.groups[ idx ] = bundle
    } else if( -1 !== idx ) {
      // @ts-ignore
      this.sdp.groups.splice( idx, 1 )
    }

    return this
  }

  /**
   * Adds ICE candidate to SDP.
   * @param { string } ip host candidate address (shared - one interface)
   * @param { number } port the (audio) channel's rtp port
   * @param { string } icepwd the (audio) channel's ice password
   * @param { object } [ permedia ] per-media-type transport override, e.g.
   *   { video: { port, icepwd } } - each media type on its own transport
   *   (no BUNDLE) advertises its own candidate port and ice password. Absent
   *   → every m-line shares the audio transport (unchanged single-transport
   *   behaviour). The host ip is shared - we gather one interface.
   */
  addicecandidates( ip, port, icepwd, permedia = {} ) {
    for( const m of this.sdp.media ) {
      /* nor does a rejected m-line gather candidates */
      if( 0 === m.port ) continue
      const t = ( m.type in permedia )? permedia[ m.type ]: { port, icepwd }
      // @ts-ignore
      m.candidates = [ {
        "foundation": 1, /* RFC 5245 4.1.1.3 */
        "component": 1,
        "transport": "udp",
        "priority": 255, /* RFC 5245 4.1.2 & 4.1.2.1 - we only have 1 candidate */
        "ip": ip,
        "port": t.port,
        "type": "host",
        "generation": 0
      }
      ]

      // @ts-ignore
      m.iceUfrag = crypto.randomBytes( 8 ).toString( "hex" )
      // @ts-ignore
      m.icePwd = t.icepwd
    }

    return this
  }

  rtcpmux() {
    for( const m of this.sdp.media ) {
      // @ts-ignore
      m.rtcpMux = "rtcp-mux"
    }
    return this
  }

  icelite() {
    // @ts-ignore
    this.sdp.icelite = "ice-lite"
    return this
  }

  clearcodecs() {

    this.sdp.media.forEach( m => {
      m.payloads = []
      m.rtp = []
      m.fmtp = []
      // @ts-ignore
      if( m.rtcpFb ) m.rtcpFb = []
    } )

    return this
  }

  /**
   * Gets a list of codecs (that we support) and return as an array of strings.
   * @param { string } type 
   * @returns { Array< string > } array of codec names in the format [ "pcma" ]
   */
  #codecs( type = "audio" ) {

    const audio = this.getmedia( type )

    /* work out an array of codecs on this side in the format of [ "pcma", "pcmu" ] */
    const ourcodecs = []
    for( const pt of audio.payloads ) {
      if( !this.#dynamicpts.haspt( pt ) ) continue
      if( this.#dynamicpts.getpt( "ilbc" ) == pt ) {
        if( -1 == getconfigforpt( audio, pt ).indexOf( "mode=30" ) )
          ourcodecs.push( this.#dynamicpts.getcodec( pt ) )
      } else {
        ourcodecs.push( this.#dynamicpts.getcodec( pt ) )
      }
    }

    return ourcodecs
  }

  /*
  Only allow CODECs supported by both sides.
  other can be:
  "pcma pcmu ..."
  "pcma,pcmu"
  "0,8"
  "0 8"
  [ "pcma", "pcmu" ]
  [ 0, 8 ]

  Returns a codec string
  "pcma pcmu"

  If first ony, it only returns the first match
  */
  intersection( other, firstonly = false ) {

    /* ensure other side is on the format [ "pcma", "pcmu" ] */
    other = this.alltocodecname( other )
    const ourcodecs = this.#codecs()

    /* intersection */
    let retval = other.filter( value => ourcodecs.includes( value ) )

    /* If fisrt only - i.e. select codec */
    if ( firstonly && 0 < retval.length ) {
      retval = [ retval[ 0 ] ]
      this.select( retval[ 0 ] )
    }

    const full = retval.join( " " )
    if( !full ) return false
    
    return full
  }

  /**
   * See other param in intersection. Confirms that we have 
   * support for at least one of the codecs in codecs
   * @param { Array< string > | string } codecs 
   */
  has( codecs ) {

    const ourcodecs = this.#codecs()
    codecs = this.alltocodecname( codecs )

    /* intersection */
    if( undefined === codecs.find( value => ourcodecs.includes( value ) ) ) return false

    return true

  }

  /**
   * @returns { object } an object of codec name to payload type
   * i.e.
   * {
   *   "ilbc": { payload: 101, codec: "iLBC", rate: 8000 }
   * }
   * NB: it only returns a) our supported codecs and b) dynamic codecs - pcma, pcmu, g722 are statically defined
   */
  getdynamicpayloadtypes() {
    const retval = {}

    this.sdp.media.forEach( ( v ) => {
      if( "rtp" in v ) {
        v.rtp.forEach( r => {
          const cname = r.codec.toLowerCase()
          switch( cname ) {
          case "ilbc":
            if( 8000 == r.rate )
              retval[ cname ] = r
            break
          case "telephone-event":
            if( 8000 == r.rate )
              retval[ "rfc2833" ] = r
          }
        } )
      }
    } )

    return retval
  }

  /**
   * Takes an object as returned by getdynamicpayloadtypes on another object
   * to set the dynameic payloadtypes on this object
   * @param { sdp } othersdp
   */
  setdynamepayloadtypes( othersdp ) {

    if( !othersdp ) return this

    const o = othersdp.getdynamicpayloadtypes()

    if( "ilbc" in o && 8000 == o.ilbc.rate ) {
      this.#dynamicpts.setdynamicpt( "ilbc", "ilbc", o.ilbc.payload )

      const m = this.sdp.media.find( mo => "audio" === mo.type )
      if( m ) {
        // @ts-ignore
        const ilbcindex = m.payloads.indexOf( prtpcodecpts.ilbc )
        if( -1 !== ilbcindex ) {
          // @ts-ignore
          m.payloads.splice( ilbcindex, 1, o.ilbc.payload )
        }
      }
    }

    if( "rfc2833" in o && 8000 == o.rfc2833.rate ) {
      this.#dynamicpts.setdynamicpt( "2833", "telephone-event", o.rfc2833.payload )

      const m = this.sdp.media.find( mo => "audio" === mo.type )
      if( m ) {
        // @ts-ignore
        const televindex = m.payloads.indexOf( prtpcodecpts[ "2833" ] )
        if( -1 !== televindex ) {
          // @ts-ignore
          m.payloads.splice( televindex, 1, o.rfc2833.payload )
        }
      }
    }

    return this
  }

  toString() {

    
    const co = Object.assign( this.sdp )


    let rfc2833 = ""
    if( this.#dynamicpts.hascodec( "2833" ) ) {
      rfc2833 = this.#dynamicpts.getpt( "2833" )
    }

    /* only return the selected codec - scoped to the m-line type the
       selection was made for, so an audio selection can no longer wipe a
       video m-line's payloads */
    co.media.forEach( ( media ) => {
      const selected = this.#selected[ media.type ]
      if( undefined === selected ) return
      media.rtp = media.rtp.filter( item => [ selected, rfc2833 ].includes( item.payload ))
      media.fmtp = media.fmtp.filter( item => [ selected, rfc2833 ].includes( item.payload ))
      media.payloads = [ selected ]
      if( rfc2833 && "audio" === media.type ) media.payloads.push( rfc2833 )
    } )

    /* We need to convert payloads back to string to stop a , being added */
    co.media.forEach( ( media, i, a ) => {
      if( Array.isArray( media.payloads ) ) {
        a[ i ].payloads = media.payloads.join( " " )
      }
    } )

    return sdptransform.write( co )
  }
}

module.exports = sdp
 