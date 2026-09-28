/*
Call-level video codec convergence (VIDEO-WAITING-ROOM). The relay cannot
transcode, so the staff leg (parent, UAS) and the guest leg (child, UAC) must
end on ONE video codec. test/interface/sdpvideo.js covers the mirrormedia
primitive; this drives the machine in call.js end to end through real calls
(#createvideochandef, #pincommonvideocodec, #relayvideocodecoffer,
#answerparent) and asserts the only invariant that matters on the wire: the
codec we accepted from staff equals the codec the guest accepted from us.

The projectrtp root hooks (run/shutdown) live in test/interface/call.js.
*/

const expect = require( "chai" ).expect
const srf = require( "../mock/srf.js" )

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear
/* the running callmanager's options (a scenario must have created it) */
const globalcmoptions = () => require( "../../lib/callmanager.js" ).callmanager( {} ).options
const callstore = require( "../../lib/store.js" )
const call = require( "../../lib/call.js" )
const projectrtp = require( "@babblevoice/projectrtp" ).projectrtp

/**
 * A plain RTP audio+video offer from "staff", video codecs in the given order.
 * @param { Array< string > } videocodecs - e.g. [ "vp8", "h264" ]
 * @returns { string }
 */
function staffoffer( videocodecs ) {
  const pts = { "vp8": 96, "h264": 102 }
  const lines = [
    "v=0",
    "o=- 1608235282228 0 IN IP4 127.0.0.1",
    "s=-",
    "c=IN IP4 127.0.0.1",
    "t=0 0",
    "m=audio 20000 RTP/AVP 8 101",
    "a=rtpmap:8 PCMA/8000",
    "a=rtpmap:101 telephone-event/8000",
    "a=fmtp:101 0-16",
    "a=sendrecv",
    "m=video 20002 RTP/AVP " + videocodecs.map( ( c ) => pts[ c ] ).join( " " )
  ]
  for( const c of videocodecs ) {
    if( "vp8" === c ) lines.push( "a=rtpmap:96 VP8/90000" )
    if( "h264" === c ) {
      lines.push( "a=rtpmap:102 H264/90000" )
      lines.push( "a=fmtp:102 packetization-mode=1;profile-level-id=42e01f" )
    }
  }
  lines.push( "a=sendrecv" )
  return lines.join( "\r\n" ) + "\r\n"
}

/**
 * The video codecs (lower case, in order) an SDP's video m-line carries, and
 * its port. Plain string parsing so the test does not lean on lib/sdp.js.
 * @param { string } sdp
 * @returns { { port: number, codecs: Array< string >, pts: object } }
 */
function videoof( sdp ) {
  const m = sdp.match( /^m=video (\d+) [^ ]+ ?([0-9 ]*)$/m )
  if( !m ) return { "port": 0, "codecs": [], "pts": {} }
  const rtpmaps = {}
  for( const r of sdp.matchAll( /^a=rtpmap:(\d+) (VP8|H264)\/90000$/gmi ) ) rtpmaps[ r[ 1 ] ] = r[ 2 ].toLowerCase()
  const codecs = []
  const pts = {}
  for( const pt of m[ 2 ].trim().split( " " ) ) {
    if( rtpmaps[ pt ] ) {
      codecs.push( rtpmaps[ pt ] )
      pts[ rtpmaps[ pt ] ] = pt
    }
  }
  return { "port": parseInt( m[ 1 ] ), codecs, pts }
}

/**
 * Mock guest: answers the offer's audio and accepts the FIRST codec from its
 * own preference list that the offer carries (using the offer's PT), or
 * rejects video with port 0 when none match.
 * @param { string } offer
 * @param { Array< string > } preference
 * @param { string } [ h264fmtp ] - an a=fmtp config to answer h264 with
 * @returns { { sdp: string, codec: string | undefined } }
 */
function guestanswer( offer, preference, h264fmtp ) {
  const ov = videoof( offer )
  const codec = preference.find( ( c ) => ov.codecs.includes( c ) )

  const lines = [
    "v=0",
    "o=- 1608235282229 0 IN IP4 127.0.0.1",
    "s=-",
    "c=IN IP4 127.0.0.1",
    "t=0 0",
    "m=audio 30000 RTP/AVP 8 101",
    "a=rtpmap:8 PCMA/8000",
    "a=rtpmap:101 telephone-event/8000",
    "a=fmtp:101 0-16",
    "a=sendrecv"
  ]
  if( codec ) {
    const pt = ov.pts[ codec ]
    lines.push( `m=video 30002 RTP/AVP ${pt}` )
    lines.push( `a=rtpmap:${pt} ${"vp8" === codec ? "VP8" : "H264"}/90000` )
    if( "h264" === codec && h264fmtp ) lines.push( `a=fmtp:${pt} ${h264fmtp}` )
    lines.push( "a=sendrecv" )
  } else if( 0 < ov.port ) {
    lines.push( "m=video 0 RTP/AVP 96" )
  }
  return { "sdp": lines.join( "\r\n" ) + "\r\n", codec }
}

/**
 * The m-lines of an SDP, in order: type, port, direction and the section's
 * text. Plain string parsing, as videoof.
 * @param { string } sdp
 * @returns { Array< { type: string, port: number, direction: string | undefined, text: string } > }
 */
function mlines( sdp ) {
  return sdp.split( /\r\n(?=m=)/ ).slice( 1 ).map( ( text ) => {
    const m = text.match( /^m=(\w+) (\d+)/ )
    const d = text.match( /^a=(sendrecv|sendonly|recvonly|inactive)$/m )
    return { "type": m[ 1 ], "port": parseInt( m[ 2 ] ), "direction": d? d[ 1 ]: undefined, text }
  } )
}

/**
 * Resolve with the first ev on em, or reject after ms.
 * @param { object } em - anything with once/off
 * @param { string } ev
 * @param { number } [ ms ]
 * @returns { Promise< any > }
 */
function waitfor( em, ev, ms = 2000 ) {
  return new Promise( ( resolve, reject ) => {
    const done = ( arg ) => {
      clearTimeout( timer )
      resolve( arg )
    }
    const timer = setTimeout( () => {
      em.off( ev, done )
      reject( new Error( "no " + ev + " within " + ms + "mS" ) )
    }, ms )
    em.once( ev, done )
  } )
}

/**
 * @param { number } ms
 * @returns { Promise< void > }
 */
function sleep( ms ) {
  return new Promise( ( resolve ) => setTimeout( resolve, ms ) )
}

/**
 * Were these two channels bridged (in either direction)?
 * @param { Array< Array< object > > } mixes - recorded [ channel, other ] pairs
 * @param { object } a
 * @param { object } b
 * @returns { boolean }
 */
function mixed( mixes, a, b ) {
  return mixes.some( ( [ x, y ] ) => ( x === a && y === b ) || ( x === b && y === a ) )
}

/**
 * A model of projectrtp's relay/mix GROUP rules (rust/src/channel/relay.rs
 * join): both legs ungrouped -> a new group of two; one grouped -> the other
 * joins it; same group -> no-op; DIFFERENT groups -> refused (no merge).
 * unmix() or close() leaves the group. The installed projectrtp does not
 * model groups, so without this a leg that was never unmixed before being
 * re-paired would still "mix" in the test while the real relay refuses it.
 * Driven by the real call.js calls via the prototype spies below.
 */
class groupmodel {
  constructor() { this.of = new Map() }
  /** @returns { boolean } false when projectrtp would refuse */
  mix( a, b ) {
    if( a === b ) return true
    const ga = this.of.get( a ), gb = this.of.get( b )
    if( ga && gb ) return ga === gb
    const g = ga || gb || new Set()
    g.add( a ).add( b )
    this.of.set( a, g ).set( b, g )
    return true
  }
  leave( a ) {
    const g = this.of.get( a )
    if( g ) g.delete( a )
    this.of.delete( a )
  }
  /** the members a relays to/from, itself excluded */
  peers( a ) {
    return [ ...( this.of.get( a ) || [] ) ].filter( ( m ) => m !== a )
  }
}

describe( "call video codec convergence", function() {

  /* Record every channel mix. Channels are native projectrtp objects, so we
     spy on their shared prototype, found via a throwaway relay channel. */
  let mixes = []
  let unmixes = []
  let channelproto, originalmix, originalunmix, originalclose
  /* projectrtp's group rules applied to every mix/unmix/close call.js makes */
  let groups = new groupmodel()
  let refusedmixes = []
  /* and the def each channel was opened with, to see which codec it relays */
  const opened = new WeakMap()
  const originalopen = projectrtp.openchannel
  /* every relay (video) channel def opened, in order */
  let relayopens = []
  before( async function() {
    projectrtp.openchannel = async function( params, cb ) {
      const chan = await originalopen.call( this, params, cb )
      opened.set( chan, params )
      if( params && params.relay ) relayopens.push( params )
      return chan
    }
    const probe = await projectrtp.openchannel( { "relay": true } )
    channelproto = Object.getPrototypeOf( probe )
    probe.close()
    originalmix = channelproto.mix
    channelproto.mix = function( other ) {
      mixes.push( [ this, other ] )
      /* and a relay cannot group legs on two different nodes (the tests
         below model nodes with a connection.instance, as a remote leg has) */
      const na = this.connection && this.connection.instance
      const nb = other && other.connection && other.connection.instance
      if( na && nb && na !== nb ) refusedmixes.push( [ this, other ] )
      else if( !groups.mix( this, other ) ) refusedmixes.push( [ this, other ] )
      return originalmix.call( this, other )
    }
    /* and every unmix: relay legs have audio-mix group semantics, so a
       re-paired video leg must be unmixed first (the local projectrtp does
       not model groups, so we assert the calls) */
    originalunmix = channelproto.unmix
    channelproto.unmix = function() {
      unmixes.push( this )
      groups.leave( this )
      return originalunmix.call( this )
    }
    originalclose = channelproto.close
    channelproto.close = function( ...args ) {
      groups.leave( this )
      return originalclose.apply( this, args )
    }
  } )

  after( function() {
    channelproto.close = originalclose
    channelproto.unmix = originalunmix
    channelproto.mix = originalmix
    projectrtp.openchannel = originalopen
  } )

  afterEach( function() {
    clearcallmanager()
  } )

  beforeEach( function() {
    mixes = []
    unmixes = []
    relayopens = []
    groups = new groupmodel()
    refusedmixes = []
    clearcallmanager()
  } )

  /**
   * Set up a scenario: inbound staff call offering staffcodecs (or the given
   * raw offer), a guest that answers with guestpreference. Captures staff's
   * answer and our offer.
   */
  async function scenario( staffcodecs, guestpreference, rawoffer, guesth264fmtp ) {
    const srfscenario = new srf.srfscenario()
    const captured = { "staffanswer": undefined, "guestoffer": undefined, "guestcodec": undefined }

    srfscenario.oncreateUAS( ( req, res, options ) => {
      captured.staffanswer = options.localSdp
      return new srf.dialog()
    } )

    srfscenario.oncreateUAC( ( contact, options ) => {
      captured.guestoffer = options.localSdp
      const answer = guestanswer( options.localSdp, guestpreference, guesth264fmtp )
      captured.guestcodec = answer.codec
      const req = new srf.req()
      req.msg.body = answer.sdp
      return new srf.dialog( req )
    } )

    const inreq = new srf.req( new srf.options() )
    inreq.msg.body = rawoffer || staffoffer( staffcodecs )

    const staff = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( c ) => { resolve( c ) } )
      srfscenario.inbound( inreq )
    } )

    return { staff, captured, srfscenario }
  }

  async function teardown( staff, guest ) {
    if( guest ) await guest.hangup()
    await staff.hangup()

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )
  }

  it( "parent answered last: guest's choice is pinned and the staff answer follows it", async function() {

    /* staff lists vp8 first, guest prefers h264. Staff is NOT answered yet and
       has no video option of its own - the child negotiating video must flip
       it (#answerparent) and the pin (#pincommonvideocodec) must make staff's
       answer accept h264, not staff's first-listed vp8. */
    const { staff, captured } = await scenario( [ "vp8", "h264" ], [ "h264", "vp8" ] )
    expect( staff.options.video ).to.not.equal( true )

    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    /* our offer to the guest carries staff's relay codecs in staff's order
       (#relayvideocodecoffer via peer.sdp.remote) */
    expect( videoof( captured.guestoffer ).codecs ).to.deep.equal( [ "vp8", "h264" ] )
    expect( captured.guestcodec ).to.equal( "h264" )

    /* the flip happened and staff's answer accepts exactly the guest's codec */
    expect( staff.options.video ).to.be.true
    const sv = videoof( captured.staffanswer )
    expect( sv.port ).to.be.above( 0 )
    expect( sv.codecs ).to.deep.equal( [ "h264" ] )
    /* and staff's relay leg carries h264's payload type (102), not vp8's (96)
       that staff listed first (#createvideochandef honours the pin) */
    expect( opened.get( staff.channels.video ).remote.codec ).to.equal( 102 )
    /* labelled, so the relay can read frame sizes (relaylimits.maxfs) */
    expect( opened.get( staff.channels.video ).remote.codecs ).to.deep.equal( { "h264": 102 } )

    expect( guest.channels.video ).to.be.an( "object" )
    expect( staff.channels.video ).to.be.an( "object" )
    /* and the two relay legs are bridged, not just opened */
    expect( mixed( mixes, guest.channels.video, staff.channels.video ) ).to.be.true

    await teardown( staff, guest )
  } )

  it( "parent answered first: the guest is offered ONLY the codec staff was already answered with", async function() {

    /* Staff is answered before the guest leg exists (hold music / queue), so
       staff's answer is already on the wire pinned to its first relay codec,
       vp8. The guest prefers h264. If we offered staff's whole list the guest
       would pick h264 and the relay would split vp8/h264 -> black screen. */
    const { staff, captured } = await scenario( [ "vp8", "h264" ], [ "h264", "vp8" ] )
    staff.options.video = true
    await staff.answer()

    const sv = videoof( captured.staffanswer )
    expect( sv.port ).to.be.above( 0 )
    expect( sv.codecs ).to.deep.equal( [ "vp8" ] )

    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    expect( videoof( captured.guestoffer ).codecs ).to.deep.equal( [ "vp8" ] )
    /* the invariant: both legs relay the same codec */
    expect( captured.guestcodec ).to.equal( sv.codecs[ 0 ] )

    expect( guest.channels.video ).to.be.an( "object" )
    expect( staff.channels.video ).to.be.an( "object" )
    /* and the two relay legs are bridged, not just opened */
    expect( mixed( mixes, guest.channels.video, staff.channels.video ) ).to.be.true

    await teardown( staff, guest )
  } )

  it( "parent answered first: a guest that cannot do the pinned codec degrades to audio rather than splitting", async function() {

    const { staff, captured } = await scenario( [ "vp8", "h264" ], [ "h264" ] )
    staff.options.video = true
    await staff.answer()
    expect( videoof( captured.staffanswer ).codecs ).to.deep.equal( [ "vp8" ] )

    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    /* offered vp8 only; an h264-only guest declines video, the unused relay
       leg is torn down and the call carries on audio-only */
    expect( videoof( captured.guestoffer ).codecs ).to.deep.equal( [ "vp8" ] )
    expect( captured.guestcodec ).to.be.undefined
    expect( guest.channels.audio ).to.be.an( "object" )
    expect( guest.channels.video ).to.be.undefined

    await teardown( staff, guest )
  } )

  it( "adopt-and-mix: independently negotiated legs on DIFFERENT codecs bridge audio but not video", async function() {

    /* Queue / ring-group shape: staff is answered first (pinned vp8), the
       guest leg is dialled on its own with no parent (so nothing constrains
       its offer) and picks h264, and only then is it adopted and mixed.
       Bridging vp8 to h264 through a relay renders nothing. */
    const { staff, captured } = await scenario( [ "vp8", "h264" ], [ "h264", "vp8" ] )
    staff.options.video = true
    await staff.answer()
    expect( videoof( captured.staffanswer ).codecs ).to.deep.equal( [ "vp8" ] )

    const guest = await call.newuac( { "contact": "1000@dummy", "video": true } )
    expect( captured.guestcodec ).to.equal( "h264" )
    expect( guest.channels.video ).to.be.an( "object" )

    const mixdone = new Promise( ( resolve ) => staff._em.once( "call.mix", resolve ) )
    staff.adopt( guest, true )
    await mixdone

    expect( mixed( mixes, staff.channels.audio, guest.channels.audio ) ).to.be.true
    expect( mixed( mixes, staff.channels.video, guest.channels.video ) ).to.be.false

    await teardown( staff, guest )
  } )

  it( "adopt-and-mix: independently negotiated legs on the SAME codec bridge video", async function() {

    const { staff, captured } = await scenario( [ "vp8", "h264" ], [ "vp8", "h264" ] )
    staff.options.video = true
    await staff.answer()

    const guest = await call.newuac( { "contact": "1000@dummy", "video": true } )
    expect( captured.guestcodec ).to.equal( "vp8" )

    const mixdone = new Promise( ( resolve ) => staff._em.once( "call.mix", resolve ) )
    staff.adopt( guest, true )
    await mixdone

    expect( mixed( mixes, staff.channels.video, guest.channels.video ) ).to.be.true

    await teardown( staff, guest )
  } )
  it( "h264: staff offering High first is answered on its constrained-baseline payload, relay included", async function() {

    /* Safari lists High (640c1f) first. The guest leg is always offered our
       42e01f;packetization-mode=1, so accepting High from staff would put two
       profiles on one relay. Answer and relay channel must both pick 102. */
    const offer = staffoffer( [ "h264" ] )
      .replace( "m=video 20002 RTP/AVP 102", "m=video 20002 RTP/AVP 100 102" )
      .replace( "a=rtpmap:102 H264/90000", "a=rtpmap:100 H264/90000\r\n" +
        "a=fmtp:100 packetization-mode=1;profile-level-id=640c1f\r\n" +
        "a=rtcp-fb:100 nack pli\r\n" +
        "a=rtpmap:102 H264/90000\r\n" +
        "a=rtcp-fb:102 nack\r\n" +
        "a=rtcp-fb:102 nack pli\r\n" +
        "a=rtcp-fb:102 goog-remb" )
    expect( videoof( offer ).codecs ).to.deep.equal( [ "h264", "h264" ] )
    const { staff, captured } = await scenario( [], [ "h264" ], offer )

    staff.options.video = true
    await staff.answer()

    const answer = captured.staffanswer
    expect( answer ).to.match( /^m=video \d+ RTP\/AVP 102$/m )
    expect( answer ).to.include( "a=fmtp:102 packetization-mode=1;profile-level-id=42e01f" )
    expect( answer ).to.not.include( "640c1f" )
    /* feedback: what staff offered on 102, minus goog-remb */
    const fb = answer.split( "\r\n" ).filter( ( l ) => l.startsWith( "a=rtcp-fb:" ) )
    expect( fb ).to.have.members( [ "a=rtcp-fb:102 nack", "a=rtcp-fb:102 nack pli" ] )
    expect( opened.get( staff.channels.video ).remote.codec ).to.equal( 102 )

    await teardown( staff )
  } )

  it( "h264 level: each leg is held to a level the other leg declared it decodes", async function() {

    /* staff can take level 4.0 (0x28), the guest only 2.1 (0x15). The relay
       forwards each side's stream to the other untouched, so staff must be
       answered at 2.1 (it sends what the guest decodes) and the guest
       offered no more than our 3.1 (what it sends must suit staff at 4.0
       and our registry ceiling). Profile and packetization-mode stay. */
    const offer = staffoffer( [ "h264" ] ).replace( "profile-level-id=42e01f", "profile-level-id=42e028" )
    const { staff, captured } = await scenario( [], [ "h264" ], offer,
      "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e015" )

    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    expect( captured.guestoffer ).to.match( /^a=fmtp:\d+ .*profile-level-id=42e01f/m )
    expect( captured.staffanswer ).to.include( "a=fmtp:102 packetization-mode=1;profile-level-id=42e015" )
    expect( captured.staffanswer ).to.not.include( "42e028" )

    await teardown( staff, guest )
  } )

  it( "h264 level: a guest is never offered a higher level than staff declared", async function() {

    /* staff decodes 1.3 (0x0d): offering the guest our 3.1 would let it send
       staff a stream staff cannot decode */
    const offer = staffoffer( [ "h264" ] ).replace( "profile-level-id=42e01f", "profile-level-id=42e00d" )
    const { staff, captured } = await scenario( [], [ "h264" ], offer )

    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    expect( captured.guestoffer ).to.match( /^a=fmtp:\d+ profile-level-id=42e00d;packetization-mode=1;level-asymmetry-allowed=1$/m )
    expect( captured.staffanswer ).to.include( "a=fmtp:102 packetization-mode=1;profile-level-id=42e00d" )

    await teardown( staff, guest )
  } )

  it( "h264 level: a staff leg declaring level 1b holds the guest to 1b, not 1.1", async function() {

    /* 42f00b is level 1b - level_idc 11 WITH constraint_set3 (RFC 6184).
       Capping our 42e01f to a bare level_idc 11 would read 42e00b, level 1.1:
       more than staff decodes. */
    const offer = staffoffer( [ "h264" ] ).replace( "profile-level-id=42e01f", "profile-level-id=42f00b" )
    const { staff, captured } = await scenario( [], [ "h264" ], offer )

    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    expect( captured.guestoffer ).to.match( /^a=fmtp:\d+ profile-level-id=42f00b;packetization-mode=1;level-asymmetry-allowed=1$/m )
    expect( captured.guestoffer ).to.not.include( "42e00b" )
    expect( captured.staffanswer ).to.include( "a=fmtp:102 packetization-mode=1;profile-level-id=42f00b" )

    await teardown( staff, guest )
  } )

  it( "silent answer end to end: staff dials a guest with autoanswer + video, both legs relay one codec, hangup is clean", async function() {

    /* The shape babble-sip's callguest() drives for "*" + 8 digits: staff's
       leg (UAS) offers audio + h264 (on its own PT, 125) + vp8, and we call
       the guest with { autoanswer: true, video: true }. The guest (a mock
       JsSIP) answers immediately, accepting h264 on the PT we offered with a
       lower level. What this CANNOT cover: real media (no RTP flows through
       the relay, no browser decodes anything), ICE/DTLS on the guest's
       WebRTC transport (plain RTP here) and JsSIP's own auto-answer logic -
       only that the INVITE carries the headers it keys on. */
    const offer = staffoffer( [ "h264", "vp8" ] )
      .replace( "RTP/AVP 102 96", "RTP/AVP 125 96" )
      .replace( "a=rtpmap:102 H264/90000", "a=rtpmap:125 H264/90000\r\na=rtcp-fb:125 nack\r\na=rtcp-fb:125 nack pli\r\na=rtcp-fb:125 transport-cc" )
      .replace( "a=fmtp:102 packetization-mode=1;profile-level-id=42e01f", "a=fmtp:125 packetization-mode=1;profile-level-id=42e01f;level-asymmetry-allowed=1" )

    const srfscenario = new srf.srfscenario()
    const captured = {}
    srfscenario.oncreateUAS( ( req, res, options ) => {
      captured.staffanswer = options.localSdp
      return new srf.dialog()
    } )
    srfscenario.oncreateUAC( ( contact, options ) => {
      captured.contact = contact
      captured.headers = options.headers
      captured.guestoffer = options.localSdp
      const answer = guestanswer( options.localSdp, [ "h264", "vp8" ],
        "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e016" )
      captured.guestcodec = answer.codec
      const req = new srf.req()
      req.msg.body = answer.sdp
      return new srf.dialog( req )
    } )

    const inreq = new srf.req( new srf.options() )
    inreq.msg.body = offer
    const staff = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( c ) => { resolve( c ) } )
      srfscenario.inbound( inreq )
    } )

    /* the guest leg's relay is opened bare (offer path) and pointed at the
       guest by remote() once the answer arrives - record that */
    const remotes = new Map()
    const originalremote = channelproto.remote
    channelproto.remote = function( r ) {
      remotes.set( this, r )
      return originalremote.call( this, r )
    }
    let guest
    try {
      /* hangupparentonhangup as babble-sip configures the callmanager */
      guest = await staff.newuac( { "contact": "sip:87654321@dummy.com", "autoanswer": true, "video": true, "hangupparentonhangup": true } )
    } finally {
      // eslint-disable-next-line require-atomic-updates
      channelproto.remote = originalremote
    }

    /* the silent-answer signalling the guest client keys on */
    expect( captured.headers[ "call-info" ] ).to.match( /;answer-after=0$/ )
    expect( captured.headers[ "alert-info" ] ).to.equal( "auto-answer" )
    expect( captured.contact ).to.equal( "sip:87654321@dummy.com;intercom=true" )

    /* our offer to the guest: staff's relay codecs in staff's order, h264
       constrained baseline mode 1, only feedback the relay honours */
    const gv = videoof( captured.guestoffer )
    expect( gv.port ).to.be.above( 0 )
    expect( gv.codecs ).to.deep.equal( [ "h264", "vp8" ] )
    expect( captured.guestoffer ).to.match( new RegExp( `^a=fmtp:${gv.pts.h264} profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1$`, "m" ) )
    for( const l of captured.guestoffer.split( "\r\n" ).filter( ( l ) => l.startsWith( "a=rtcp-fb:" ) ) ) {
      expect( l ).to.match( /^a=rtcp-fb:\d+ (nack|nack pli|ccm fir)$/ )
    }
    expect( captured.guestcodec ).to.equal( "h264" )

    /* staff's answer (sent once the guest answered) accepts the same codec
       on staff's own PT, at the guest's lower level, feedback staff offered
       minus transport-cc */
    expect( staff.options.video ).to.be.true
    const sv = videoof( captured.staffanswer )
    expect( sv.port ).to.be.above( 0 )
    expect( sv.codecs ).to.deep.equal( [ "h264" ] )
    expect( sv.pts.h264 ).to.equal( "125" )
    expect( captured.staffanswer ).to.include( "a=fmtp:125 packetization-mode=1;profile-level-id=42e016;level-asymmetry-allowed=1" )
    expect( captured.staffanswer ).to.not.match( /transport-cc|a=extmap|rtx|red\/|ulpfec/ )

    /* each relay leg targets its own side's PT for the one common codec,
       the two are bridged, and by projectrtp's group rules relay only to
       each other */
    expect( opened.get( staff.channels.video ).remote.codec ).to.equal( 125 )
    expect( opened.get( staff.channels.video ).remote.codecs ).to.deep.equal( { "h264": 125 } )
    expect( String( remotes.get( guest.channels.video ).codec ) ).to.equal( gv.pts.h264 )
    expect( remotes.get( guest.channels.video ).port ).to.equal( 30002 )
    expect( groups.peers( staff.channels.video ) ).to.deep.equal( [ guest.channels.video ] )
    expect( refusedmixes ).to.deep.equal( [] )

    /* both established legs watch their relay leg for media (VWR-1) */
    expect( staff._timers.videomonitor ).to.not.be.undefined
    expect( guest._timers.videomonitor ).to.not.be.undefined

    /* the guest hangs up (BYE from the wire): staff follows, both video
       legs are closed out of their group, nothing is left in the store */
    const staffvideo = staff.channels.video
    const guestvideo = guest.channels.video
    await guest._onhangup( "wire" )
    expect( staff._timers.videomonitor ).to.be.undefined
    expect( guest._timers.videomonitor ).to.be.undefined
    expect( staff.destroyed ).to.be.true
    expect( staff.hangup_cause.reason ).to.equal( "NORMAL_CLEARING" )
    expect( staff.channels.video ).to.be.undefined
    expect( guest.channels.video ).to.be.undefined
    expect( groups.peers( staffvideo ) ).to.deep.equal( [] )
    expect( groups.peers( guestvideo ) ).to.deep.equal( [] )
    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )
  } )

  it( "a video relay leg closing on its own is recorded as video and the call carries on audio-only", async function() {

    /* projectrtp idle-times-out a relay leg after 20s without RTP (guest
       backgrounded / recvonly). That close must not be filed as audio, must
       forget the dead channel, and must not end the call. */
    const { staff } = await scenario( [ "vp8" ], [ "vp8" ] )
    staff.options.video = true
    await staff.answer()

    const video = staff.channels.video
    expect( video ).to.be.an( "object" )
    expect( staff.channels.count ).to.equal( 2 )

    const closed = new Promise( ( resolve ) => staff._em.on( "channel", ( ev ) => {
      if( "close" === ev.event.action ) resolve( ev.event )
    } ) )
    /* what the idle timeout does: projectrtp closes the channel under us */
    video.close()
    await closed

    expect( staff.channels.video ).to.be.undefined
    expect( staff.channels.closed.video ).to.have.lengthOf( 1 )
    expect( staff.channels.closed.audio ).to.have.lengthOf( 0 )
    expect( staff.channels.count ).to.equal( 1 )
    expect( staff.channels.audio ).to.be.an( "object" )
    expect( staff.destroyed ).to.not.equal( true )
    expect( staff.state.cleaned ).to.not.equal( true )

    /* a normal hangup still cleans the call up (no stale video close) */
    await teardown( staff )
  } )
  /* A projectrtp without relay mode ignores { relay: true } and opens an
     ordinary audio channel: it has no livestats(), or (a build with livestats
     but not relay) reports relay: false. Either way no video may ride it. */
  for( const [ name, livestats ] of [
    [ "no livestats", undefined ],
    [ "livestats says relay: false", function() { return { "relay": false } } ] ] ) {

    it( `projectrtp without relay mode (${name}): video is rejected and the call carries on audio-only`, async function() {
      const originallivestats = channelproto.livestats
      channelproto.livestats = livestats
      try {
        const { staff, captured } = await scenario( [ "vp8" ], [ "vp8" ] )
        staff.options.video = true
        await staff.answer()

        /* the relay leg was tried, found not to be one, and closed */
        expect( relayopens ).to.have.lengthOf( 1 )
        expect( staff.channels.video ).to.be.undefined
        expect( staff.channels.audio ).to.be.an( "object" )
        expect( captured.staffanswer ).to.match( /m=video 0 / )

        const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )
        expect( guest.channels.video ).to.be.undefined
        const isrelay = ( c ) => !!( opened.get( c ) && opened.get( c ).relay )
        expect( mixes ).to.not.be.empty
        expect( mixes.every( ( [ x, y ] ) => !isrelay( x ) && !isrelay( y ) ) ).to.be.true

        await teardown( staff, guest )
      } finally {
        // eslint-disable-next-line require-atomic-updates
        channelproto.livestats = originallivestats
      }
    } )
  }

  /* staff's offer with no m=video at all */
  const audioonlyoffer = staffoffer( [] ).replace( /m=video[^]*$/, "" )

  it( "audio-only staff: a guest dialled with video is offered no video and no relay leg is opened", async function() {

    /* Staff offered audio only. Offering the guest our fallback h264/vp8
       would open a relay leg on the guest, flip staff to video and open a
       bare relay on staff too - two legs with nothing to carry. */
    expect( audioonlyoffer ).to.not.include( "m=video" )
    const { staff, captured } = await scenario( [], [ "vp8", "h264" ], audioonlyoffer )

    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    expect( captured.guestoffer ).to.not.include( "m=video" )
    expect( captured.guestcodec ).to.be.undefined
    expect( guest.channels.audio ).to.be.an( "object" )
    expect( guest.channels.video ).to.be.undefined
    expect( staff.options.video ).to.not.equal( true )
    expect( staff.channels.video ).to.be.undefined
    expect( captured.staffanswer ).to.not.include( "m=video" )
    expect( relayopens ).to.have.lengthOf( 0 )
    expect( mixed( mixes, staff.channels.audio, guest.channels.audio ) ).to.be.true
    expect( mixes.every( ( [ x, y ] ) => x !== guest.channels.video && y !== guest.channels.video ) ).to.be.true

    await teardown( staff, guest )
  } )

  it( "audio-only staff answered first: the guest is still offered no video", async function() {

    const { staff, captured } = await scenario( [], [ "vp8" ], audioonlyoffer )
    staff.options.video = true
    await staff.answer()
    expect( staff.channels.video ).to.be.undefined
    expect( staff.channels.count ).to.equal( 1 )

    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    expect( captured.guestoffer ).to.not.include( "m=video" )
    expect( guest.channels.video ).to.be.undefined
    expect( relayopens ).to.have.lengthOf( 0 )

    await teardown( staff, guest )
  } )

  /* staff's video offer is not relayable: VP9 only, or a disabled (port 0)
     vp8 m-line. No bare relay may be opened and left behind. */
  const vp9only = staffoffer( [ "vp8" ] )
    .replace( "RTP/AVP 96", "RTP/AVP 98" ).replace( "a=rtpmap:96 VP8/90000", "a=rtpmap:98 VP9/90000" )
  const disabledvideo = staffoffer( [ "vp8" ] ).replace( "m=video 20002", "m=video 0" )

  for( const [ name, offer ] of [ [ "vp9 only", vp9only ], [ "port 0", disabledvideo ] ] ) {
    it( `answer path: video we cannot relay (${name}) opens no relay leg and is rejected`, async function() {

      const { staff, captured } = await scenario( [], [ "vp8" ], offer )
      staff.options.video = true
      await staff.answer()

      expect( staff.channels.video ).to.be.undefined
      expect( staff.channels.count ).to.equal( 1 )
      expect( relayopens ).to.have.lengthOf( 0 )
      expect( videoof( captured.staffanswer ).port ).to.equal( 0 )

      await teardown( staff )
    } )
  }
  /* staff offering h264 the relay cannot carry to our 42e01f;mode-1 leg */
  const highoffer = ( codecs ) => staffoffer( codecs ).replace( "profile-level-id=42e01f", "profile-level-id=640c1f" )
  const mode0offer = ( codecs ) => staffoffer( codecs ).replace( "packetization-mode=1", "packetization-mode=0" )

  for( const [ name, offer ] of [ [ "High", highoffer( [ "h264" ] ) ], [ "packetization-mode=0", mode0offer( [ "h264" ] ) ] ] ) {
    it( `h264 ${name} only: staff's video is rejected, no relay leg, the guest is offered no video`, async function() {

      const { staff, captured } = await scenario( [], [ "h264", "vp8" ], offer )
      const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

      expect( captured.guestoffer ).to.not.include( "m=video" )
      expect( guest.channels.video ).to.be.undefined
      expect( staff.options.video ).to.not.equal( true )
      expect( videoof( captured.staffanswer ).port ).to.equal( 0 )
      expect( staff.channels.video ).to.be.undefined
      expect( relayopens ).to.have.lengthOf( 0 )

      await teardown( staff, guest )
    } )
  }

  it( "h264 High listed before vp8: staff and guest converge on vp8", async function() {

    const { staff, captured } = await scenario( [], [ "h264", "vp8" ], highoffer( [ "h264", "vp8" ] ) )
    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    /* the guest prefers h264 but is only offered what staff can relay */
    expect( videoof( captured.guestoffer ).codecs ).to.deep.equal( [ "vp8" ] )
    expect( captured.guestcodec ).to.equal( "vp8" )
    expect( videoof( captured.staffanswer ).codecs ).to.deep.equal( [ "vp8" ] )
    expect( opened.get( staff.channels.video ).remote.codec ).to.equal( 96 )
    /* labelled, so the relay can read frame sizes (relaylimits.maxfs) */
    expect( opened.get( staff.channels.video ).remote.codecs ).to.deep.equal( { "vp8": 96 } )
    expect( mixed( mixes, guest.channels.video, staff.channels.video ) ).to.be.true

    await teardown( staff, guest )
  } )
  it( "extmap: staff's header extensions reach neither staff's answer nor the guest's offer", async function() {

    /* the relay forwards header extensions verbatim, so both legs would need
       identical IDs per URI - we negotiate none on either leg instead */
    const offer = staffoffer( [ "vp8" ] ).replace( "a=rtpmap:96 VP8/90000", [
      "a=rtpmap:96 VP8/90000",
      "a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
      "a=extmap:13 urn:3gpp:video-orientation",
      "a=rtcp-fb:96 transport-cc",
      "a=rtcp-fb:96 nack pli"
    ].join( "\r\n" ) )
    const { staff, captured } = await scenario( [], [ "vp8" ], offer )
    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    expect( captured.guestcodec ).to.equal( "vp8" )
    for( const sdp of [ captured.staffanswer, captured.guestoffer ] ) {
      expect( videoof( sdp ).port ).to.be.above( 0 )
      expect( sdp ).to.not.include( "a=extmap" )
      expect( sdp ).to.not.include( "transport-cc" )
    }
    expect( captured.staffanswer ).to.include( "a=rtcp-fb:96 nack pli" )

    await teardown( staff, guest )
  } )
  it( "detach( true ) unmixes the video relay leg with the audio; detach() leaves both", async function() {

    const { staff } = await scenario( [ "vp8" ], [ "vp8" ] )
    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )
    expect( mixed( mixes, guest.channels.video, staff.channels.video ) ).to.be.true

    guest.detach()
    expect( unmixes ).to.have.lengthOf( 0 )

    staff.detach( true )
    expect( unmixes ).to.include( staff.channels.audio )
    expect( unmixes ).to.include( staff.channels.video )
    expect( unmixes ).to.not.include( guest.channels.video )
    /* by projectrtp's group rules: staff's video now relays to nobody */
    expect( groups.peers( staff.channels.video ) ).to.deep.equal( [] )

    await teardown( staff, guest )
  } )

  it( "blind xfer: both video relay legs leave their pairing", async function() {

    const { staff } = await scenario( [ "vp8" ], [ "vp8" ] )
    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )
    const staffvideo = staff.channels.video
    const guestvideo = guest.channels.video
    expect( mixed( mixes, guestvideo, staffvideo ) ).to.be.true

    const req = new srf.req( new srf.options() )
    const res = new srf.res()
    req.setparsedheader( "refer-to", { "uri": "sip:alice@atlanta.example.com" } )
    let sipcodesent
    res.onsend( ( sipcode ) => { sipcodesent = sipcode } )

    guest.referauthrequired = false
    await guest._dialog.callbacks.refer( req, res )
    expect( sipcodesent ).to.equal( 202 )

    expect( unmixes ).to.include( staffvideo )
    expect( unmixes ).to.include( guestvideo )
    expect( groups.peers( staffvideo ) ).to.not.include( guestvideo )
    expect( groups.peers( guestvideo ) ).to.deep.equal( [] )

    guest._onhangup( "wire" )
    await staff.hangup()
  } )

  it( "attended xfer: all four video legs are unmixed and a_1/c_1 re-pair as their own relay", async function() {

    /* a_1 <- b_1 (held) and b_2 -> c_1, b_2 refers: ends a_1 - c_1. Without
       unmixing video, a_1 and c_1 would join b's groups (3-way) or fail -
       groupmodel applies projectrtp's rule that it is refused. */
    const srfscenario = new srf.srfscenario()
    srfscenario.oncreateUAS( () => new srf.dialog() )
    srfscenario.oncreateUAC( ( contact, options ) => {
      const req = new srf.req()
      req.msg.body = guestanswer( options.localSdp, [ "vp8" ] ).sdp
      return new srf.dialog( req )
    } )
    const inbound = () => new Promise( ( resolve ) => {
      const inreq = new srf.req( new srf.options() )
      inreq.msg.body = staffoffer( [ "vp8" ] )
      srfscenario.oncall( async ( c ) => { resolve( c ) } )
      srfscenario.inbound( inreq )
    } )

    const b_1 = await inbound()
    const a_1 = await b_1.newuac( { "contact": "1000@dummy", "video": true } )
    const b_2 = await inbound()
    b_2.options.video = true
    await b_2.answer()
    const c_1 = await b_2.newuac( { "contact": "1001@dummy", "video": true } )

    const legs = [ a_1, b_1, b_2, c_1 ]
    const videos = legs.map( ( l ) => l.channels.video )
    for( const v of videos ) expect( v ).to.be.an( "object" )
    expect( mixed( mixes, a_1.channels.video, b_1.channels.video ) ).to.be.true
    expect( mixed( mixes, c_1.channels.video, b_2.channels.video ) ).to.be.true

    const req = new srf.req( new srf.options() )
    const res = new srf.res()
    const callid = b_1.sip.callid
    const totag = b_1.sip.tags.local
    const fromtag = b_1.sip.tags.remote
    req.setparsedheader( "refer-to", { "uri": `sip:1000@dummy.com?Replaces=${callid}%3Bto-tag%3D${totag}%3Bfrom-tag%3D${fromtag}` } )

    b_2.referauthrequired = false
    await b_2._dialog.callbacks.refer( req, res )

    for( const v of videos ) expect( unmixes ).to.include( v )
    /* and the re-pair happened after the unmixes, on video too */
    const repair = mixes.findIndex( ( [ x, y ] ) =>
      ( x === c_1.channels.video && y === a_1.channels.video ) || ( x === a_1.channels.video && y === c_1.channels.video ) )
    expect( repair ).to.be.above( -1 )
    /* by projectrtp's group rules the re-pair only succeeds because both
       legs left b's groups first: mixing legs already in different groups is
       refused. a_1 and c_1 now relay to each other and to nobody else. */
    expect( refusedmixes ).to.deep.equal( [] )
    expect( groups.peers( a_1.channels.video ) ).to.deep.equal( [ c_1.channels.video ] )
    expect( groups.peers( c_1.channels.video ) ).to.deep.equal( [ a_1.channels.video ] )

    await b_2._onhangup( "wire" )
    await a_1.hangup()
    await c_1.hangup()
    expect( await callstore.stats() ).to.deep.include( { "storebycallid": 0, "storebyuuid": 0 } )
  } )

  /* ---- hold (VIDEO-WAITING-ROOM-2 gap 1) ---- */

  /**
   * Staff (UAS, answered) bridged to a guest, both with video on vp8.
   * @returns { Promise< object > }
   */
  async function bridgedvideocall( guestoptions = {} ) {
    const r = await scenario( [ "vp8" ], [ "vp8" ] )
    /* hold plays music on hold to the other party */
    r.staff.moh = { "files": [ { "wav": "/tmp/nonexistent-moh.wav" } ] }
    const guest = await r.staff.newuac( { "contact": "1000@dummy", "video": true, ...guestoptions } )
    expect( mixed( mixes, guest.channels.video, r.staff.channels.video ) ).to.be.true
    expect( groups.peers( r.staff.channels.video ) ).to.deep.equal( [ guest.channels.video ] )
    return { ...r, guest }
  }

  /**
   * Send a re-INVITE carrying sdp into call's dialog; resolve the 200's body.
   * @param { object } c - the call
   * @param { string } sdp
   * @returns { string }
   */
  function reinviteinto( c, sdp ) {
    const req = new srf.req( new srf.options() )
    req.msg.body = sdp
    const res = new srf.res()
    let sent
    res.onsend( ( code, msg ) => { sent = { code, msg } } )
    c._dialog.callbacks.modify( req, res )
    expect( sent.code ).to.equal( 200 )
    return sent.msg.body
  }

  it( "hold: a sendonly re-offer is answered recvonly on video too, and both video legs leave their pairing until unhold", async function() {

    const { staff, guest } = await bridgedvideocall()
    const staffvideo = staff.channels.video
    const guestvideo = guest.channels.video

    /* staff puts us on hold: every m-line sendonly */
    const held = reinviteinto( staff, staffoffer( [ "vp8" ] ).replace( /a=sendrecv/g, "a=sendonly" ) )
    const heldlines = mlines( held )
    expect( heldlines.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video" ] )
    expect( heldlines[ 0 ].direction ).to.equal( "recvonly" )
    /* RFC 3264 6.1: sendonly is answered recvonly - not sendrecv */
    expect( heldlines[ 1 ].port ).to.equal( staffvideo.local.port )
    expect( heldlines[ 1 ].direction ).to.equal( "recvonly" )
    expect( staff.state.held ).to.be.true

    /* and neither camera reaches the other party while held */
    expect( unmixes ).to.include( staffvideo )
    expect( unmixes ).to.include( guestvideo )
    expect( groups.peers( staffvideo ) ).to.deep.equal( [] )
    expect( groups.peers( guestvideo ) ).to.deep.equal( [] )

    /* off hold: sendrecv again and the relay legs re-paired */
    const unheld = reinviteinto( staff, staffoffer( [ "vp8" ] ) )
    const unheldlines = mlines( unheld )
    expect( unheldlines[ 0 ].direction ).to.equal( "sendrecv" )
    expect( unheldlines[ 1 ].direction ).to.equal( "sendrecv" )
    expect( groups.peers( staffvideo ) ).to.deep.equal( [ guestvideo ] )
    expect( refusedmixes ).to.deep.equal( [] )

    await teardown( staff, guest )
  } )

  it( "hold: an inactive re-offer is answered inactive on video", async function() {

    const { staff, guest } = await bridgedvideocall()
    const held = reinviteinto( staff, staffoffer( [ "vp8" ] ).replace( /a=sendrecv/g, "a=inactive" ) )
    expect( mlines( held ).map( ( m ) => m.direction ) ).to.deep.equal( [ "inactive", "inactive" ] )
    expect( groups.peers( staff.channels.video ) ).to.deep.equal( [] )

    await teardown( staff, guest )
  } )

  it( "hold: a server-side hold() offers video inactive and stops both cameras; unhold() re-pairs them", async function() {

    const { staff, guest } = await bridgedvideocall()
    const staffvideo = staff.channels.video
    const guestvideo = guest.channels.video

    const offers = []
    staff._dialog.modify = ( sdp ) => {
      offers.push( sdp )
      return Promise.resolve( sdp )
    }

    staff.hold()
    expect( offers ).to.have.lengthOf( 1 )
    const held = mlines( offers[ 0 ] )
    expect( held.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video" ] )
    expect( held[ 1 ].port ).to.equal( staffvideo.local.port )
    expect( held[ 1 ].direction ).to.equal( "inactive" )
    expect( groups.peers( staffvideo ) ).to.deep.equal( [] )
    expect( groups.peers( guestvideo ) ).to.deep.equal( [] )

    staff.unhold()
    expect( offers ).to.have.lengthOf( 2 )
    expect( mlines( offers[ 1 ] )[ 1 ].direction ).to.equal( "sendrecv" )
    await sleep( 5 )
    expect( groups.peers( staffvideo ) ).to.deep.equal( [ guestvideo ] )

    await teardown( staff, guest )
  } )

  /* ---- re-offers keep their m-lines (gap 2) ---- */

  it( "reinvite: once the video leg has idle-closed the re-offer still carries the video m-line, disabled with port 0", async function() {

    const { staff, guest } = await bridgedvideocall()
    const firstoffer = guest.sdp.local.toString()
    expect( mlines( firstoffer ).map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video" ] )

    /* projectrtp idle-closes the guest's relay leg */
    const closed = new Promise( ( resolve ) => guest._em.on( "channel", ( ev ) => {
      if( "close" === ev.event.action ) resolve()
    } ) )
    guest.channels.video.close()
    await closed
    expect( guest.channels.video ).to.be.undefined

    let reoffer
    guest._dialog.request = async ( opts ) => {
      reoffer = opts.body
      return {}
    }
    await guest.reinvite()

    /* RFC 3264 8.1: same m-lines, same order; the dead one disabled */
    const lines = mlines( reoffer )
    expect( lines.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video" ] )
    expect( lines[ 0 ].port ).to.equal( guest.channels.audio.local.port )
    expect( lines[ 1 ].port ).to.equal( 0 )
    /* and the origin is the same session, one version on (RFC 3264 8) */
    const origin = ( sdp ) => sdp.match( /^o=\S+ (\d+) (\d+)/m ).slice( 1 ).map( Number )
    expect( origin( reoffer )[ 0 ] ).to.equal( origin( firstoffer )[ 0 ] )
    expect( origin( reoffer )[ 1 ] ).to.equal( origin( firstoffer )[ 1 ] + 1 )

    await teardown( staff, guest )
  } )

  it( "reinvite: the re-answer re-points the video leg (the far end moved), and one declining video closes it", async function() {

    const { staff, guest } = await bridgedvideocall()
    const guestvideo = guest.channels.video

    const remotes = []
    const originalremote = channelproto.remote
    channelproto.remote = function( r ) {
      remotes.push( [ this, r ] )
      return originalremote.call( this, r )
    }
    try {
      /* an unchanged re-answer leaves the leg alone: remote() would restart
         its DTLS handshake */
      guest._dialog.request = async ( opts ) =>
        ( { "msg": { "status": 200, "body": guestanswer( opts.body, [ "vp8" ] ).sdp } } )
      await guest.reinvite()
      expect( remotes.filter( ( [ c ] ) => c === guestvideo ) ).to.have.lengthOf( 0 )
      expect( guest.channels.video ).to.equal( guestvideo )

      let reoffer
      guest._dialog.request = async ( opts ) => {
        reoffer = opts.body
        const moved = guestanswer( opts.body, [ "vp8" ] ).sdp.replace( "m=video 30002", "m=video 30010" )
        return { "msg": { "status": 200, "body": moved } }
      }
      await guest.reinvite()

      /* the re-offer still offers our live leg */
      expect( videoof( reoffer ).port ).to.equal( guestvideo.local.port )
      const pointed = remotes.filter( ( [ c ] ) => c === guestvideo ).map( ( [ , r ] ) => r )
      expect( pointed ).to.have.lengthOf( 1 )
      expect( pointed[ 0 ].port ).to.equal( 30010 )
      expect( String( pointed[ 0 ].codec ) ).to.equal( "96" )
      expect( guest.channels.video ).to.equal( guestvideo )

      /* declined this time: the relay leg is dropped */
      guest._dialog.request = async ( opts ) => {
        const declined = guestanswer( opts.body, [] ).sdp
        return { "msg": { "status": 200, "body": declined } }
      }
      await guest.reinvite()
      expect( guest.channels.video ).to.be.undefined
    } finally {
      // eslint-disable-next-line require-atomic-updates
      channelproto.remote = originalremote
    }

    await teardown( staff, guest )
  } )

  /* ---- incoming re-offers are answered m-line for m-line (gap 3) ---- */

  /* a screen share: a second video m-line after the camera */
  const withscreenshare = ( offer ) => offer + [
    "m=video 20004 RTP/AVP 96",
    "a=rtpmap:96 VP8/90000",
    "a=sendonly" ].join( "\r\n" ) + "\r\n"

  it( "re-INVITE adding a screen share: every offered m-line is answered, the extra one rejected with port 0", async function() {

    const { staff, guest } = await bridgedvideocall()
    const answer = reinviteinto( staff, withscreenshare( staffoffer( [ "vp8" ] ) ) )

    const lines = mlines( answer )
    expect( lines.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video", "video" ] )
    expect( lines[ 0 ].port ).to.equal( staff.channels.audio.local.port )
    /* the camera stays on our relay leg */
    expect( lines[ 1 ].port ).to.equal( staff.channels.video.local.port )
    expect( lines[ 1 ].direction ).to.equal( "sendrecv" )
    expect( lines[ 2 ].port ).to.equal( 0 )
    /* nothing about the pairing changed */
    expect( groups.peers( staff.channels.video ) ).to.deep.equal( [ guest.channels.video ] )

    await teardown( staff, guest )
  } )

  it( "re-INVITE adding video to an audio-only call is answered with video rejected, not dropped", async function() {

    const { staff, captured } = await scenario( [], [ "vp8" ], audioonlyoffer )
    await staff.answer()
    expect( captured.staffanswer ).to.not.include( "m=video" )

    const answer = reinviteinto( staff, staffoffer( [ "vp8" ] ) )
    const lines = mlines( answer )
    expect( lines.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video" ] )
    expect( lines[ 0 ].port ).to.equal( staff.channels.audio.local.port )
    expect( lines[ 1 ].port ).to.equal( 0 )
    expect( staff.channels.video ).to.be.undefined

    await teardown( staff )
  } )

  /* ---- which video m-line the relay carries (gap 4) ---- */

  it( "an offer whose first video m-line is disabled: the relay and the answer both take the live one", async function() {

    const offer = staffoffer( [ "vp8" ] ).replace( "m=video 20002", "m=video 0" ) + [
      "m=video 20004 RTP/AVP 96",
      "a=rtpmap:96 VP8/90000",
      "a=sendrecv" ].join( "\r\n" ) + "\r\n"
    const { staff, captured } = await scenario( [], [ "vp8" ], offer )
    staff.options.video = true
    await staff.answer()

    const lines = mlines( captured.staffanswer )
    expect( lines.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video", "video" ] )
    /* RFC 3264 6: a disabled offered stream is answered disabled */
    expect( lines[ 1 ].port ).to.equal( 0 )
    expect( lines[ 2 ].port ).to.equal( staff.channels.video.local.port )
    /* and the relay points at that same m-line */
    expect( opened.get( staff.channels.video ).remote.port ).to.equal( 20004 )

    await teardown( staff )
  } )

  /* ---- mixing across projectrtp nodes (gap 5) ---- */

  /**
   * Staff answered on "node-a", a guest dialled standalone on "node-b" (the
   * queue shape: adopt-and-mix). Nodes are modelled as a remote leg has
   * them, connection.instance; a channel staff's node opens is on node-a.
   * @param { boolean } staffvideo - staff negotiates video
   * @param { object } [ guestoptions ] - extra newuac options for the guest
   * @returns { Promise< object > }
   */
  async function twonodes( staffvideo, guestoptions = {} ) {
    const r = await scenario( [ "vp8" ], [ "vp8" ] )
    const { staff } = r
    if( staffvideo ) staff.options.video = true
    await staff.answer()
    const guest = await call.newuac( { "contact": "1000@dummy", "video": true, ...guestoptions } )
    expect( guest.channels.video ).to.be.an( "object" )

    const nodea = { "instance": "node-a" }
    const nodeb = { "instance": "node-b" }
    staff.channels.audio.connection = nodea
    if( staff.channels.video ) staff.channels.video.connection = nodea
    guest.channels.audio.connection = nodeb
    guest.channels.video.connection = nodeb

    const staffaudio = staff.channels.audio
    const openonnodea = staffaudio.openchannel
    staffaudio.openchannel = async ( def, cb ) => {
      const c = await openonnodea( def, cb )
      c.connection = nodea
      return c
    }

    const reoffers = []
    guest._dialog.request = async ( opts ) => {
      reoffers.push( opts.body )
      return { "msg": { "status": 200, "body": guestanswer( opts.body, [ "vp8" ] ).sdp } }
    }
    return { ...r, guest, reoffers, nodea }
  }

  it( "cross-node mix: the guest's video relay leg moves to staff's node with its audio, is re-offered, and bridged", async function() {

    const { staff, guest, reoffers, nodea } = await twonodes( true )
    const oldguestvideo = guest.channels.video
    const oldguestaudio = guest.channels.audio

    await staff.mix( guest )

    /* audio moved (as before) and so did video */
    expect( guest.channels.audio ).to.not.equal( oldguestaudio )
    expect( guest.channels.video ).to.be.an( "object" )
    expect( guest.channels.video ).to.not.equal( oldguestvideo )
    expect( guest.channels.video.connection ).to.equal( nodea )
    /* opened as a relay leg towards the same place, same codec */
    expect( opened.get( guest.channels.video ).relay ).to.be.true
    expect( opened.get( guest.channels.video ).remote.port ).to.equal( 30002 )
    expect( String( opened.get( guest.channels.video ).remote.codec ) ).to.equal( "96" )
    expect( opened.get( guest.channels.video ).remote.codecs ).to.deep.equal( { "vp8": opened.get( guest.channels.video ).remote.codec } )

    /* the reinvite offered the new leg's port, not the old node's */
    expect( reoffers ).to.have.lengthOf( 1 )
    expect( videoof( reoffers[ 0 ] ).port ).to.equal( guest.channels.video.local.port )

    /* bridged on one node - nothing refused - and the old leg is gone */
    expect( mixed( mixes, staff.channels.video, guest.channels.video ) ).to.be.true
    expect( refusedmixes ).to.deep.equal( [] )
    expect( groups.peers( staff.channels.video ) ).to.deep.equal( [ guest.channels.video ] )
    expect( groups.peers( oldguestvideo ) ).to.deep.equal( [] )
    await sleep( 5 )
    expect( guest.channels.closed.video ).to.have.lengthOf( 1 )
    /* the old leg's close did not forget the new one */
    expect( guest.channels.video ).to.be.an( "object" )

    await teardown( staff, guest )
  } )

  it( "cross-node mix: when the video leg cannot move (no video on staff's side) video is dropped to port 0, never offered from the old node", async function() {

    const { staff, guest, reoffers } = await twonodes( false )
    expect( staff.channels.video ).to.be.undefined
    const oldguestvideo = guest.channels.video

    await staff.mix( guest )

    expect( guest.channels.video ).to.be.undefined
    expect( reoffers ).to.have.lengthOf( 1 )
    const lines = mlines( reoffers[ 0 ] )
    expect( lines.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video" ] )
    expect( lines[ 1 ].port ).to.equal( 0 )
    expect( refusedmixes ).to.deep.equal( [] )
    expect( groups.peers( oldguestvideo ) ).to.deep.equal( [] )

    await teardown( staff, guest )
  } )

  /* ---- review follow-ups ---- */

  it( "staff answered with video rejected: a guest dialled with video is offered none (no orphan relay leg)", async function() {

    /* staff offered vp8 but was answered without video (options.video not
       set), so it has no relay leg: a relay leg on the guest would carry
       its camera to nobody */
    const { staff, captured } = await scenario( [ "vp8" ], [ "vp8" ] )
    await staff.answer()
    expect( videoof( captured.staffanswer ).port ).to.equal( 0 )
    expect( staff.channels.video ).to.be.undefined

    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )

    expect( captured.guestoffer ).to.not.include( "m=video" )
    expect( guest.channels.video ).to.be.undefined
    expect( relayopens ).to.have.lengthOf( 0 )

    await teardown( staff, guest )
  } )

  for( const [ name, refuse ] of [
    [ "returns false", function() { return false } ],
    [ "throws", function() { throw new Error( "relay join refused" ) } ] ] ) {

    it( `mix(): a video relay mix that projectrtp refuses (${name}) is logged, audio still mixes`, async function() {

      const { staff } = await scenario( [ "vp8" ], [ "vp8" ] )
      staff.options.video = true
      await staff.answer()
      const guest = await call.newuac( { "contact": "1000@dummy", "video": true } )

      const spy = channelproto.mix
      channelproto.mix = function( other ) {
        if( opened.get( this ) && opened.get( this ).relay ) return refuse()
        return spy.call( this, other )
      }
      const errors = []
      const originalerror = console.error
      console.error = ( ...args ) => errors.push( args.join( " " ) )
      try {
        const mixevent = waitfor( staff._em, "call.mix" )
        await staff.mix( guest )
        await mixevent
      } finally {
        // eslint-disable-next-line require-atomic-updates
        console.error = originalerror
        // eslint-disable-next-line require-atomic-updates
        channelproto.mix = spy
      }

      expect( mixed( mixes, staff.channels.audio, guest.channels.audio ) ).to.be.true
      expect( errors.some( ( e ) => /video relay legs/.test( e ) ) ).to.be.true

      await teardown( staff, guest )
    } )
  }

  /* ---- no-media monitoring (VIDEO-WAITING-ROOM-1, gap 6) ---- */

  /**
   * Staff answered with a video relay leg, monitored fast.
   * @returns { Promise< object > }
   */
  async function monitoredstaff() {
    const r = await scenario( [ "vp8" ], [ "vp8" ] )
    r.staff.options.video = true
    r.staff.options.videomonitor = { "interval": 20, "nomedia": 100 }
    await r.staff.answer()
    expect( r.staff.channels.video ).to.be.an( "object" )
    return r
  }

  it( "no media: an established call whose video leg receives nothing raises call.video.nomedia, and call.video.media when it flows", async function() {

    const { staff, srfscenario } = await monitoredstaff()
    const globalem = srfscenario.options.em

    /* the local relay leg receives nothing: in.accepted + in.rtcp stay 0 */
    const onglobal = waitfor( globalem, "call.video.nomedia" )
    const c = await waitfor( staff._em, "call.video.nomedia" )
    expect( c ).to.equal( staff )
    expect( await onglobal ).to.equal( staff )

    expect( staff.videomonitor.nomedia ).to.be.true
    expect( staff.videomonitor.stats ).to.be.an( "object" )
    expect( staff.videomonitor.stats.relay ).to.be.true
    expect( staff.videomonitor.stats.in ).to.be.an( "object" )
    expect( staff.videomonitor.history ).to.have.lengthOf( 1 )
    expect( staff.videomonitor.history[ 0 ] ).to.include( { "event": "nomedia" } )
    expect( staff.videomonitor.history[ 0 ].idlems ).to.be.at.least( 100 )

    /* raised once, not on every poll */
    await sleep( 150 )
    expect( staff.videomonitor.history ).to.have.lengthOf( 1 )

    /* media arrives (authenticated RTCP counts too) */
    let accepted = 0
    staff.channels.video.livestats = () => ( { "relay": true, "in": { "count": accepted, "accepted": ++accepted, "rtcp": 1 }, "out": { "count": 0 } } )
    const onglobalmedia = waitfor( globalem, "call.video.media" )
    await waitfor( staff._em, "call.video.media" )
    await onglobalmedia
    expect( staff.videomonitor.nomedia ).to.be.false
    expect( staff.videomonitor.history.map( ( h ) => h.event ) ).to.deep.equal( [ "nomedia", "media" ] )
    expect( staff.videomonitor.stats.in.accepted ).to.be.above( 0 )

    await teardown( staff )
    expect( staff._timers.videomonitor ).to.be.undefined
  } )

  it( "no media: livestats is polled one request at a time, and a rejected or timed-out one never throws", async function() {

    const { staff } = await monitoredstaff()
    let calls = 0, inflight = 0, maxinflight = 0
    staff.channels.video.livestats = () => {
      calls++
      inflight++
      maxinflight = Math.max( maxinflight, inflight )
      /* slower than the poll interval, then fails as a silent node's does */
      return new Promise( ( resolve, reject ) => setTimeout( () => {
        inflight--
        reject( new Error( "timed out waiting for livestats" ) )
      }, 50 ) )
    }
    await sleep( 250 )

    expect( calls ).to.be.at.least( 2 )
    expect( maxinflight ).to.equal( 1 )
    /* failed polls are no samples - neither media nor its absence */
    expect( staff.videomonitor.history ).to.have.lengthOf( 0 )

    /* one that throws outright is no different */
    staff.channels.video.livestats = () => { throw new Error( "Unknown method" ) }
    await sleep( 60 )
    expect( staff.videomonitor.history ).to.have.lengthOf( 0 )

    await teardown( staff )
    await sleep( 60 )
    expect( inflight ).to.equal( 0 )
  } )

  it( "no media: a leg without livestats is not polled, and the monitor stops with the leg", async function() {

    const { staff } = await monitoredstaff()
    expect( staff._timers.videomonitor ).to.not.be.undefined

    staff.channels.video.livestats = undefined
    await sleep( 60 )
    expect( staff._timers.videomonitor ).to.be.undefined
    expect( staff.videomonitor.history ).to.have.lengthOf( 0 )

    await teardown( staff )
  } )

  it( "no media: the monitor stops when the video leg idle-closes, and on every hangup path", async function() {

    /* the leg closes under us (projectrtp idle timeout) */
    const first = await monitoredstaff()
    let polls = 0
    const video = first.staff.channels.video
    const livestats = video.livestats.bind( video )
    video.livestats = ( ...args ) => {
      polls++
      return livestats( ...args )
    }
    await sleep( 50 )
    expect( polls ).to.be.above( 0 )
    const closed = new Promise( ( resolve ) => first.staff._em.on( "channel", ( ev ) => {
      if( "close" === ev.event.action ) resolve()
    } ) )
    video.close()
    await closed
    await sleep( 50 )
    expect( first.staff._timers.videomonitor ).to.be.undefined
    const after = polls
    await sleep( 60 )
    expect( polls ).to.equal( after )
    await teardown( first.staff )

    /* a BYE from the wire on a bridged call: both legs' monitors stop */
    const { staff, guest } = await bridgedvideocall( { "hangupparentonhangup": true } )
    staff.options.videomonitor = guest.options.videomonitor = { "interval": 20, "nomedia": 100 }
    expect( staff._timers.videomonitor ).to.not.be.undefined
    expect( guest._timers.videomonitor ).to.not.be.undefined
    await guest._onhangup( "wire" )
    expect( staff.destroyed ).to.be.true
    expect( staff._timers.videomonitor ).to.be.undefined
    expect( guest._timers.videomonitor ).to.be.undefined
    expect( await callstore.stats() ).to.deep.include( { "storebycallid": 0, "storebyuuid": 0 } )
  } )

  it( "no media: nothing is raised while the call is on hold", async function() {

    const { staff } = await monitoredstaff()
    reinviteinto( staff, staffoffer( [ "vp8" ] ).replace( /a=sendrecv/g, "a=inactive" ) )
    expect( staff.state.held ).to.be.true
    await sleep( 250 )
    expect( staff.videomonitor.history ).to.have.lengthOf( 0 )

    await teardown( staff )
  } )
  /* ---- video limits: enforced by the relay, advertised in our SDP ---- */

  /* lib/call.js videolimitdefaults, burst derived as 1 s of bitrate */
  const defaultlimits = { "bitrate": 2000000, "burst": 250000, "packetrate": 1000, "framerate": 30, "maxfs": 3600 }

  /** the video m-section of an SDP string */
  function videosection( sdp ) {
    return mlines( sdp ).find( ( m ) => "video" === m.type ).text
  }

  /** the b= lines of a section */
  function blines( section ) {
    return section.split( "\r\n" ).filter( ( l ) => l.startsWith( "b=" ) )
  }

  it( "video limits: every relay leg is opened with relaylimits, and staff's answer and the guest's offer both advertise them", async function() {

    const { staff, captured } = await scenario( [ "vp8", "h264" ], [ "vp8" ] )
    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )
    expect( guest.channels.video ).to.be.an( "object" )
    expect( staff.channels.video ).to.be.an( "object" )

    /* both relay legs, as projectrtp received them */
    expect( relayopens ).to.have.lengthOf( 2 )
    for( const def of relayopens ) expect( def.relaylimits ).to.deep.equal( defaultlimits )
    expect( opened.get( staff.channels.video ).relaylimits ).to.deep.equal( defaultlimits )
    expect( opened.get( guest.channels.video ).relaylimits ).to.deep.equal( defaultlimits )
    /* audio channels are not relay legs */
    expect( opened.get( staff.channels.audio ).relaylimits ).to.be.undefined

    /* and the SDP both parties get says the same, just under the cap */
    for( const sdp of [ captured.staffanswer, captured.guestoffer ] ) {
      const video = videosection( sdp )
      expect( blines( video ) ).to.deep.equal( [ "b=AS:1800", "b=TIAS:1700000" ] )
      expect( video ).to.match( /^a=fmtp:96 max-fs=3600;max-fr=30$/m )
      expect( video ).to.match( /^a=framerate:30$/m )
      expect( blines( mlines( sdp )[ 0 ].text ) ).to.deep.equal( [] )
    }
    /* our offer's h264 stays at 3.1 - exactly the default limits */
    expect( captured.guestoffer ).to.match( /^a=fmtp:\d+ profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1$/m )

    await teardown( staff, guest )
  } )

  it( "video limits: options.videolimits flow per call to the relay leg and that leg's SDP", async function() {

    const { staff, captured } = await scenario( [ "vp8" ], [ "vp8" ] )
    staff.options.videolimits = { "bitrate": 1000000, "framerate": 15, "maxfs": 1200 }
    /* bad values fall back to the default rather than reaching projectrtp */
    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true,
      "videolimits": { "bitrate": 500000, "burst": 100000, "packetrate": 300, "framerate": -1, "maxfs": "junk" } } )

    expect( opened.get( staff.channels.video ).relaylimits ).to.deep.equal(
      { "bitrate": 1000000, "burst": 125000, "packetrate": 1000, "framerate": 15, "maxfs": 1200 } )
    expect( opened.get( guest.channels.video ).relaylimits ).to.deep.equal(
      { "bitrate": 500000, "burst": 100000, "packetrate": 300, "framerate": 30, "maxfs": 3600 } )

    const staffvideo = videosection( captured.staffanswer )
    expect( blines( staffvideo ) ).to.deep.equal( [ "b=AS:900", "b=TIAS:850000" ] )
    expect( staffvideo ).to.match( /^a=fmtp:96 max-fs=1200;max-fr=15$/m )
    expect( staffvideo ).to.match( /^a=framerate:15$/m )

    const guestvideo = videosection( captured.guestoffer )
    expect( blines( guestvideo ) ).to.deep.equal( [ "b=AS:450", "b=TIAS:425000" ] )
    expect( guestvideo ).to.match( /^a=fmtp:96 max-fs=3600;max-fr=30$/m )

    await teardown( staff, guest )
  } )

  it( "video limits: 0 is unlimited - passed to the relay as 0, and nothing advertised", async function() {

    const { staff, captured } = await scenario( [ "vp8" ], [ "vp8" ] )
    staff.options.video = true
    staff.options.videolimits = { "bitrate": 0, "framerate": 0, "maxfs": 0 }
    await staff.answer()

    expect( opened.get( staff.channels.video ).relaylimits ).to.deep.equal(
      { "bitrate": 0, "burst": 0, "packetrate": 1000, "framerate": 0, "maxfs": 0 } )
    const video = videosection( captured.staffanswer )
    expect( mlines( captured.staffanswer )[ 1 ].port ).to.equal( staff.channels.video.local.port )
    expect( blines( video ) ).to.deep.equal( [] )
    expect( video ).to.not.match( /max-f|a=framerate/ )

    await teardown( staff )
  } )

  it( "video limits: a re-offer, a re-answer and a hold all carry them", async function() {

    const { staff, guest } = await bridgedvideocall()

    let reoffer
    guest._dialog.request = async ( opts ) => {
      reoffer = opts.body
      return { "msg": { "status": 200, "body": guestanswer( opts.body, [ "vp8" ] ).sdp } }
    }
    await guest.reinvite()
    expect( blines( videosection( reoffer ) ) ).to.deep.equal( [ "b=AS:1800", "b=TIAS:1700000" ] )
    expect( videosection( reoffer ) ).to.match( /^a=fmtp:96 max-fs=3600;max-fr=30$/m )

    const reanswer = reinviteinto( staff, staffoffer( [ "vp8" ] ) )
    expect( blines( videosection( reanswer ) ) ).to.deep.equal( [ "b=AS:1800", "b=TIAS:1700000" ] )
    expect( videosection( reanswer ) ).to.match( /^a=fmtp:96 max-fs=3600;max-fr=30$/m )

    const held = reinviteinto( staff, staffoffer( [ "vp8" ] ).replace( /a=sendrecv/g, "a=sendonly" ) )
    expect( mlines( held )[ 1 ].direction ).to.equal( "recvonly" )
    expect( blines( videosection( held ) ) ).to.deep.equal( [ "b=AS:1800", "b=TIAS:1700000" ] )

    await teardown( staff, guest )
  } )

  it( "video limits: the cross-node replacement relay leg is opened with the moved call's limits", async function() {

    const guestlimits = { "bitrate": 800000, "burst": 50000, "packetrate": 400, "framerate": 20, "maxfs": 1620 }
    const { staff, guest, reoffers } = await twonodes( true, { "videolimits": guestlimits } )
    const oldguestvideo = guest.channels.video
    expect( opened.get( oldguestvideo ).relaylimits ).to.deep.equal( guestlimits )

    await staff.mix( guest )

    /* opened by staff's node, but it is the guest's leg: the guest's limits */
    expect( guest.channels.video ).to.not.equal( oldguestvideo )
    expect( opened.get( guest.channels.video ).relay ).to.be.true
    expect( opened.get( guest.channels.video ).relaylimits ).to.deep.equal( guestlimits )
    expect( opened.get( staff.channels.video ).relaylimits ).to.deep.equal( defaultlimits )

    /* and the re-offer from the new node says the same */
    expect( reoffers ).to.have.lengthOf( 1 )
    const video = videosection( reoffers[ 0 ] )
    expect( blines( video ) ).to.deep.equal( [ "b=AS:720", "b=TIAS:680000" ] )
    expect( video ).to.match( /^a=fmtp:96 max-fs=1620;max-fr=20$/m )

    await teardown( staff, guest )
  } )

  it( "video limits: global and per-call videolimits merge field by field - defaults, then global, then per call", async function() {

    const { staff } = await scenario( [ "vp8" ], [ "vp8" ] )
    /* the callmanager's (global) options - the scenario's are copied over
       index.js's defaults, so reach the live object through the manager */
    globalcmoptions().videolimits = { "bitrate": 1000000, "framerate": 20 }
    /* per call: only the frame rate - the global bitrate must survive */
    staff.options.videolimits = { "framerate": 15 }
    /* a per-call value that gives no limit falls through to the global one */
    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true,
      "videolimits": { "maxfs": 1200, "framerate": -1 } } )

    expect( opened.get( staff.channels.video ).relaylimits ).to.deep.equal(
      { "bitrate": 1000000, "burst": 125000, "packetrate": 1000, "framerate": 15, "maxfs": 3600 } )
    expect( opened.get( guest.channels.video ).relaylimits ).to.deep.equal(
      { "bitrate": 1000000, "burst": 125000, "packetrate": 1000, "framerate": 20, "maxfs": 1200 } )

    await teardown( staff, guest )
  } )

  it( "video limits: burst 0 is one second of bitrate; a fraction that rounds to 0 is not unlimited; maxfs has a floor of 99", async function() {

    const { staff, captured } = await scenario( [ "vp8" ], [ "vp8" ] )
    staff.options.video = true
    staff.options.videolimits = { "bitrate": 800000, "burst": 0, "packetrate": 0.9, "framerate": 0.5, "maxfs": 40.7 }
    await staff.answer()

    /* burst 0 resolved as projectrtp resolves it; packetrate/framerate keep
       their defaults rather than becoming 0 (= unlimited); maxfs raised to
       H.264 level 1's 99 */
    expect( opened.get( staff.channels.video ).relaylimits ).to.deep.equal(
      { "bitrate": 800000, "burst": 100000, "packetrate": 1000, "framerate": 30, "maxfs": 99 } )
    /* and the SDP says the same numbers the relay enforces */
    const video = videosection( captured.staffanswer )
    expect( video ).to.match( /^a=fmtp:96 max-fs=99;max-fr=30$/m )
    expect( video ).to.match( /^a=framerate:30$/m )

    await teardown( staff )
  } )

  /** staffoffer with its video codec under payload type pt instead of 96 */
  function staffofferpt( pt ) {
    return staffoffer( [ "vp8" ] )
      .replace( "m=video 20002 RTP/AVP 96", "m=video 20002 RTP/AVP " + pt )
      .replace( "a=rtpmap:96 VP8/90000", "a=rtpmap:" + pt + " VP8/90000" )
  }

  it( "re-INVITE moving the video payload type re-points the relay leg's codec, and only then", async function() {

    const { staff, guest } = await bridgedvideocall()
    const staffvideo = staff.channels.video
    const guestvideo = guest.channels.video
    const before = opened.get( staffvideo ).remote
    expect( before.codec ).to.equal( 96 )

    const remotes = []
    const originalremote = channelproto.remote
    channelproto.remote = function( r ) {
      remotes.push( [ this, r ] )
      return originalremote.call( this, r )
    }
    try {
      /* same payload type (a session refresh): the leg is left alone */
      reinviteinto( staff, staffoffer( [ "vp8" ] ) )
      expect( remotes ).to.have.lengthOf( 0 )

      /* vp8 moves to 98: our answer accepts 98, so the leg must declare 98 */
      const answer = reinviteinto( staff, staffofferpt( 98 ) )
      expect( videoof( answer ).pts ).to.deep.equal( { "vp8": "98" } )
      const pointed = remotes.filter( ( [ c ] ) => c === staffvideo ).map( ( [ , r ] ) => r )
      expect( pointed ).to.have.lengthOf( 1 )
      expect( pointed[ 0 ].codec ).to.equal( 98 )
      expect( pointed[ 0 ].codecs ).to.deep.equal( { "vp8": 98 } )
      /* where the leg pointed before - not a new address */
      expect( pointed[ 0 ].address ).to.equal( before.address )
      expect( pointed[ 0 ].port ).to.equal( before.port )
      /* no dtls block: remote() with one restarts the DTLS handshake */
      expect( pointed[ 0 ] ).to.not.have.property( "dtls" )
      /* the guest's leg is untouched (the relay forwards by label) */
      expect( remotes.filter( ( [ c ] ) => c === guestvideo ) ).to.have.lengthOf( 0 )
      expect( staff.channels.video ).to.equal( staffvideo )
      expect( groups.peers( staffvideo ) ).to.deep.equal( [ guestvideo ] )

      /* the same re-offer again: nothing more */
      reinviteinto( staff, staffofferpt( 98 ) )
      expect( remotes ).to.have.lengthOf( 1 )

      /* a hold that also moves it back: re-pointed, and still held */
      const held = reinviteinto( staff, staffoffer( [ "vp8" ] ).replace( /a=sendrecv/g, "a=sendonly" ) )
      expect( mlines( held )[ 1 ].direction ).to.equal( "recvonly" )
      expect( remotes ).to.have.lengthOf( 2 )
      expect( remotes[ 1 ][ 0 ] ).to.equal( staffvideo )
      expect( remotes[ 1 ][ 1 ].codec ).to.equal( 96 )
      expect( remotes[ 1 ][ 1 ].codecs ).to.deep.equal( { "vp8": 96 } )
    } finally {
      // eslint-disable-next-line require-atomic-updates
      channelproto.remote = originalremote
    }

    await teardown( staff, guest )
  } )

  /** staffofferpt as a WebRTC (DTLS-SRTP) offer */
  function webrtcstaffoffer( pt ) {
    const dtls = [
      "a=ice-ufrag:K8PO",
      "a=ice-pwd:3RU9dMh3eDbYsfJIyQ4ki5va",
      "a=fingerprint:sha-256 73:D5:EC:C0:BF:A7:CA:42:1B:DE:B6:EA:CE:B9:D0:32:38:65:50:4A:27:BF:58:9A:DF:24:B2:10:53:58:88:B9",
      "a=setup:actpass",
      "a=rtcp-mux" ].join( "\r\n" )
    return staffofferpt( pt )
      .replace( /RTP\/AVP/g, "UDP/TLS/RTP/SAVPF" )
      .replace( "a=fmtp:101 0-16", "a=fmtp:101 0-16\r\n" + dtls +
        "\r\na=candidate:1 1 udp 2122260223 127.0.0.1 20000 typ host" )
      .replace( "a=rtpmap:" + pt + " VP8/90000", "a=rtpmap:" + pt + " VP8/90000\r\n" + dtls +
        "\r\na=candidate:1 1 udp 2122260223 127.0.0.1 20002 typ host" )
  }

  it( "re-INVITE moving the video payload type on a WebRTC leg re-points the codec without restarting DTLS", async function() {

    const r = await scenario( [ "vp8" ], [ "vp8" ], webrtcstaffoffer( 96 ) )
    const { staff } = r
    const guest = await staff.newuac( { "contact": "1000@dummy", "video": true } )
    const staffvideo = staff.channels.video
    expect( staffvideo ).to.be.an( "object" )
    /* a secure leg: opened with a dtls block (remote() with one restarts
       the handshake) */
    const before = opened.get( staffvideo ).remote
    expect( before.dtls ).to.be.an( "object" )
    expect( before.codec ).to.equal( 96 )

    const remotes = []
    const originalremote = channelproto.remote
    channelproto.remote = function( rem ) {
      remotes.push( [ this, rem ] )
      return originalremote.call( this, rem )
    }
    try {
      reinviteinto( staff, webrtcstaffoffer( 96 ) )
      expect( remotes ).to.have.lengthOf( 0 )

      reinviteinto( staff, webrtcstaffoffer( 98 ) )
      expect( remotes ).to.have.lengthOf( 1 )
      expect( remotes[ 0 ][ 0 ] ).to.equal( staffvideo )
      expect( remotes[ 0 ][ 1 ] ).to.deep.equal( {
        "address": before.address, "port": before.port, "codec": 98, "codecs": { "vp8": 98 } } )
    } finally {
      // eslint-disable-next-line require-atomic-updates
      channelproto.remote = originalremote
    }

    await teardown( staff, guest )
  } )
} )
