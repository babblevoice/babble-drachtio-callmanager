/*
Video negotiation at the SDP layer. The offer fixture is the shape Chrome
produces for an audio+video getUserMedia call over SIP.js: BUNDLE group,
mids 0/1, DTLS fingerprint, ICE candidates, VP8 96 + H264 102 on the video
m-line. What is pinned:

- an answer built for that offer mirrors the m-line list (count and order),
  rejecting video with port 0 when no video port is supplied and accepting
  with the offerer's own PT/fmtp when one is
- a=group:BUNDLE only appears when every active m-line shares one port -
  one channel per media type means different ports, and then no group
- getmedia( "video" ) on an audio-only SDP no longer appends a second
  AUDIO m-line (the old defaultaudiomedia() push)
- an audio codec selection no longer wipes the video m-line's payloads in
  toString()
*/

const expect = require( "chai" ).expect
const sdp = require( "../../lib/sdp" )

const chromevideoffer = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1
a=msid-semantic: WMS f1b7a4a4
c=IN IP4 192.168.0.50
m=audio 58779 UDP/TLS/RTP/SAVPF 111 0 8 101
a=candidate:1 1 udp 2113937151 192.168.0.50 58779 typ host generation 0
a=ice-ufrag:F7gI
a=ice-pwd:x9cml/YzichV2+XlhiMu8g
a=fingerprint:sha-256 D2:FA:0E:C3:22:59:5E:14:95:69:92:3D:13:B4:84:24:2C:C2:A2:C0:3E:FD:34:8E:5E:EA:6F:AF:52:CE:E6:0F
a=setup:actpass
a=mid:0
a=sendrecv
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
m=video 58781 UDP/TLS/RTP/SAVPF 96 102
a=candidate:1 1 udp 2113937151 192.168.0.50 58781 typ host generation 0
a=ice-ufrag:F7gI
a=ice-pwd:x9cml/YzichV2+XlhiMu8g
a=fingerprint:sha-256 D2:FA:0E:C3:22:59:5E:14:95:69:92:3D:13:B4:84:24:2C:C2:A2:C0:3E:FD:34:8E:5E:EA:6F:AF:52:CE:E6:0F
a=setup:actpass
a=mid:1
a=sendrecv
a=rtcp-mux
a=rtpmap:96 VP8/90000
a=rtcp-fb:96 nack
a=rtcp-fb:96 nack pli
a=rtcp-fb:96 ccm fir
a=rtpmap:102 H264/90000
a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f`.replace(/(\r\n|\n|\r)/gm, "\r\n")

describe( "sdp video", function() {

  it( "getmedia( video ) on an audio-only sdp does not append an audio m-line", async function() {
    const s = sdp.create()
    expect( s.sdp.media ).to.have.lengthOf( 1 )

    const v = s.getmedia( "video" )

    expect( v ).to.be.undefined
    expect( s.sdp.media ).to.have.lengthOf( 1 )
    expect( s.sdp.media[ 0 ].type ).to.equal( "audio" )
  } )

  it( "an answer mirrors a video offer with video rejected - port 0, order kept", async function() {

    const remote = sdp.create( chromevideoffer )
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setconnectionaddress( "127.0.0.1" )
      .setaudioport( 12000 )
      .mirrormedia( remote, {} )

    const out = local.toString()
    const reparsed = sdp.create( out ).sdp

    expect( reparsed.media ).to.have.lengthOf( 2 )
    expect( reparsed.media[ 0 ].type ).to.equal( "audio" )
    expect( reparsed.media[ 0 ].port ).to.equal( 12000 )
    expect( reparsed.media[ 1 ].type ).to.equal( "video" )
    expect( reparsed.media[ 1 ].port ).to.equal( 0 )
    /* the rejected m-line still lists the offered formats per RFC 3264 */
    expect( out ).to.include( "m=video 0" )
  } )

  it( "an answer accepts video by mirroring the offerer's PT and fmtp", async function() {

    const remote = sdp.create( chromevideoffer )
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setconnectionaddress( "127.0.0.1" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002 } )

    const reparsed = sdp.create( local.toString() ).sdp

    expect( reparsed.media ).to.have.lengthOf( 2 )
    const video = reparsed.media[ 1 ]
    expect( video.type ).to.equal( "video" )
    expect( video.port ).to.equal( 12002 )
    /* the offer listed VP8 96 first - the answer mirrors that PT verbatim */
    expect( video.rtp ).to.have.lengthOf( 1 )
    expect( video.rtp[ 0 ].codec ).to.equal( "VP8" )
    expect( video.rtp[ 0 ].payload ).to.equal( 96 )
    expect( video.rtp[ 0 ].rate ).to.equal( 90000 )
  } )

  it( "mirrormedia({videocodec}) accepts the PINNED codec, not the offer's first", async function() {

    /* The relay cannot transcode, so both legs must land on one codec. This
       offer lists VP8 96 first (which the default rule would pick), but the
       paired leg fixed h264 - the answer must honour the pin, or we would
       accept VP8 while the peer sends H264 and forward each under the other's
       payload type (the VIDEO-WAITING-ROOM black-screen bug). */
    const remote = sdp.create( chromevideoffer )
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setconnectionaddress( "127.0.0.1" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002, "videocodec": "h264" } )

    const video = sdp.create( local.toString() ).sdp.media[ 1 ]
    expect( video.type ).to.equal( "video" )
    expect( video.port ).to.equal( 12002 )
    expect( video.rtp ).to.have.lengthOf( 1 )
    expect( video.rtp[ 0 ].codec ).to.equal( "H264" )
    expect( video.rtp[ 0 ].payload ).to.equal( 102 )
    /* and the h264 fmtp travels with it, not vp8's */
    expect( video.fmtp[ 0 ].config ).to.include( "profile-level-id" )
  } )

  it( "mirrormedia({videocodec}) rejects video (port 0) when the pinned codec is absent", async function() {

    /* Pinned to h264 but the offerer only put vp8 on the wire: better to drop
       video than accept a codec the peer leg is not carrying. */
    const vp8only = chromevideoffer
      .replace( "m=video 58781 UDP/TLS/RTP/SAVPF 96 102", "m=video 58781 UDP/TLS/RTP/SAVPF 96" )
      .replace( "a=rtpmap:102 H264/90000\r\n", "" )
      .replace( "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f", "" )

    const remote = sdp.create( vp8only )
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setconnectionaddress( "127.0.0.1" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002, "videocodec": "h264" } )

    const video = sdp.create( local.toString() ).sdp.media[ 1 ]
    expect( video.type ).to.equal( "video" )
    expect( video.port ).to.equal( 0 )
  } )

  it( "an accepted h264-only offer mirrors the offerer's h264 fmtp", async function() {

    const h264only = chromevideoffer
      .replace( "m=video 58781 UDP/TLS/RTP/SAVPF 96 102", "m=video 58781 UDP/TLS/RTP/SAVPF 102" )
      .replace( "a=rtpmap:96 VP8/90000\r\n", "" )
      .replace( "a=rtcp-fb:96 nack\r\n", "" )
      .replace( "a=rtcp-fb:96 nack pli\r\n", "" )
      .replace( "a=rtcp-fb:96 ccm fir\r\n", "" )

    const remote = sdp.create( h264only )
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002 } )

    const reparsed = sdp.create( local.toString() ).sdp
    const video = reparsed.media[ 1 ]

    expect( video.rtp[ 0 ].codec ).to.equal( "H264" )
    expect( video.rtp[ 0 ].payload ).to.equal( 102 )
    /* the OFFERER's profile, not our registry default */
    expect( video.fmtp[ 0 ].config ).to.include( "profile-level-id=42001f" )
    expect( video.fmtp[ 0 ].payload ).to.equal( 102 )
  } )

  it( "secure() emits no BUNDLE group when active m-lines sit on different ports", async function() {

    const remote = sdp.create( chromevideoffer )
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002 } )
      .addssrc( 1122334455 )
      .secure( "AA:BB", "passive" )

    const out = local.toString()

    expect( out ).to.not.include( "a=group:BUNDLE" )
    /* mids mirrored from the offer, per m-line */
    expect( out ).to.include( "a=mid:0" )
    expect( out ).to.include( "a=mid:1" )
  } )

  it( "secure() keeps the single-m-line BUNDLE exactly as before", async function() {

    const local = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .addssrc( 1122334455 )
      .secure( "AA:BB", "passive" )

    expect( local.toString() ).to.include( "a=group:BUNDLE 0" )
  } )

  it( "an audio selection no longer wipes the video m-line's payloads", async function() {

    const remote = sdp.create( chromevideoffer )
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002 } )

    local.select( "pcma" )
    const reparsed = sdp.create( local.toString() ).sdp

    /* audio narrowed to the selection (plus the rfc2833 PT, as always)... */
    expect( reparsed.media[ 0 ].payloads ).to.deep.equal( [ 8, 101 ] )
    /* ...while video keeps its mirrored payload */
    expect( reparsed.media[ 1 ].payloads ).to.deep.equal( [ 96 ] )
    expect( reparsed.media[ 1 ].rtp ).to.have.lengthOf( 1 )
  } )

  it( "a video-first offer keeps its m-line order in the answer", async function() {

    /* swap the m-line order: video first, audio second */
    const lines = chromevideoffer.split( "\r\n" )
    const audiostart = lines.findIndex( ( l ) => l.startsWith( "m=audio" ) )
    const videostart = lines.findIndex( ( l ) => l.startsWith( "m=video" ) )
    const header = lines.slice( 0, audiostart )
    const audiosection = lines.slice( audiostart, videostart )
    const videosection = lines.slice( videostart )
    const videofirst = [ ...header, ...videosection, ...audiosection ].join( "\r\n" )

    const remote = sdp.create( videofirst )
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, {} )

    const reparsed = sdp.create( local.toString() ).sdp
    expect( reparsed.media ).to.have.lengthOf( 2 )
    expect( reparsed.media[ 0 ].type ).to.equal( "video" )
    expect( reparsed.media[ 0 ].port ).to.equal( 0 )
    expect( reparsed.media[ 1 ].type ).to.equal( "audio" )
    expect( reparsed.media[ 1 ].port ).to.equal( 12000 )
  } )

  it( "video pt bookkeeping does not clobber audio ilbc at 97", async function() {

    /* a video m-line reusing 97 must not break the audio ilbc mapping */
    const offer97 = chromevideoffer
      .replace( "m=video 58781 UDP/TLS/RTP/SAVPF 96 102", "m=video 58781 UDP/TLS/RTP/SAVPF 97" )
      .replace( "a=rtpmap:96 VP8/90000", "a=rtpmap:97 VP8/90000" )
      .replace( "m=audio 58779 UDP/TLS/RTP/SAVPF 111 0 8 101", "m=audio 58779 UDP/TLS/RTP/SAVPF 97 101" )
      .replace( "a=rtpmap:111 opus/48000/2\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000", "a=rtpmap:97 iLBC/8000\r\na=fmtp:97 mode=20" )

    const remote = sdp.create( offer97 )

    /* audio 97 still resolves to ilbc for the intersection logic */
    expect( remote.intersection( "ilbc pcmu" ) ).to.equal( "ilbc" )
  } )

  it( "addssrc/addicecandidates give the video m-line its own transport (two-transport, no BUNDLE)", async function() {

    /* the call.js path: audio channel on one port/ssrc/icepwd, video relay
       on its own. The webrtc decorators must advertise each per m-line, and
       differing ports must drop the BUNDLE group. */
    const remote = sdp.create( chromevideoffer )
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { videoport: 12002 } )
      .addssrc( 111111, { "video": 222222 } )
      .secure( "AA:BB:CC", "actpass" )
      .addicecandidates( "10.0.0.1", 12000, "audiopwd", { "video": { "port": 12002, "icepwd": "videopwd" } } )
      .rtcpmux()
      .icelite()

    const reparsed = sdp.create( local.toString() ).sdp
    const audio = reparsed.media.find( ( m ) => "audio" === m.type )
    const video = reparsed.media.find( ( m ) => "video" === m.type )

    /* each m-line advertises its own candidate port and ice password */
    expect( audio.candidates[ 0 ].port ).to.equal( 12000 )
    expect( audio.icePwd ).to.equal( "audiopwd" )
    expect( video.candidates[ 0 ].port ).to.equal( 12002 )
    expect( video.icePwd ).to.equal( "videopwd" )

    /* each carries its own ssrc */
    expect( audio.ssrcs.every( ( s ) => 111111 === s.id ) ).to.equal( true )
    expect( video.ssrcs.every( ( s ) => 222222 === s.id ) ).to.equal( true )

    /* two transports (different ports) → no BUNDLE group */
    const groups = reparsed.groups || []
    expect( groups.find( ( g ) => "BUNDLE" === g.type ) ).to.equal( undefined )
  } )

  it( "without a per-media override every m-line shares the audio transport (unchanged)", async function() {

    /* the audio-only decorator behaviour must be byte-identical when no
       override is passed - guards against the per-media change leaking */
    const local = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .addssrc( 111111 )
      .addicecandidates( "10.0.0.1", 12000, "audiopwd" )

    const reparsed = sdp.create( local.toString() ).sdp
    const audio = reparsed.media.find( ( m ) => "audio" === m.type )
    expect( audio.candidates[ 0 ].port ).to.equal( 12000 )
    expect( audio.icePwd ).to.equal( "audiopwd" )
    expect( audio.ssrcs.every( ( s ) => 111111 === s.id ) ).to.equal( true )
  } )
  /* Safari's shape: several h264 payloads, High (640c1f) listed first. The
     leg we offer to always gets our 42e01f;packetization-mode=1, and the relay
     cannot transcode, so the leg we answer must pick constrained baseline. */
  const safarih264offer = chromevideoffer
    .substring( 0, chromevideoffer.indexOf( "a=rtpmap:96 VP8/90000" ) )
    .replace( "m=video 58781 UDP/TLS/RTP/SAVPF 96 102", "m=video 58781 UDP/TLS/RTP/SAVPF 100 101 104 102" ) + [
    "a=rtpmap:100 H264/90000",
    "a=fmtp:100 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f",
    "a=rtpmap:101 H264/90000",
    "a=fmtp:101 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
    "a=rtpmap:104 H264/90000",
    "a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
    "a=rtpmap:102 H264/90000",
    "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
  ].join( "\r\n" )

  it( "h264: the answer prefers packetization-mode=1 constrained baseline over the offer's first h264", async function() {

    for( const videocodec of [ undefined, "h264" ] ) {
      const remote = sdp.create( safarih264offer )
      const local = sdp.create()
        .addcodecs( "pcma" )
        .setaudioport( 12000 )
        .mirrormedia( remote, { "videoport": 12002, videocodec } )

      const video = sdp.create( local.toString() ).sdp.media[ 1 ]
      expect( video.port ).to.equal( 12002 )
      expect( video.rtp ).to.have.lengthOf( 1 )
      /* not High 100, not mode-0 101, not plain baseline 104 */
      expect( video.rtp[ 0 ].payload ).to.equal( 102 )
      expect( video.fmtp ).to.have.lengthOf( 1 )
      expect( video.fmtp[ 0 ].config ).to.include( "profile-level-id=42e01f" )
      expect( video.fmtp[ 0 ].config ).to.include( "packetization-mode=1" )
      /* and the relay channel chooser agrees with the answer */
      expect( sdp.choosevideocodec( remote.getmedia( "video" ), videocodec ).payload ).to.equal( 102 )
    }
  } )

  it( "h264: plain baseline mode 1 beats High; High and mode-0 alone are not relayable", async function() {

    /* drop h264 payloads from the fixture (m= format list and a= lines) */
    const without = ( pts ) => {
      let o = safarih264offer
      for( const pt of pts ) {
        o = o.replace( " " + pt, "" )
          .replace( new RegExp( `a=(rtpmap|fmtp):${pt} [^\\r]*(\\r\\n)?`, "g" ), "" )
      }
      return o
    }

    /* no constrained baseline - 104 (42001f mode 1) is the best left */
    const remote = sdp.create( without( [ 102 ] ) )
    expect( sdp.choosevideocodec( remote.getmedia( "video" ) ).payload ).to.equal( 104 )

    /* nothing baseline-with-mode-1 at all (High 100, mode-0 101): the relay
       cannot carry either to our 42e01f;packetization-mode=1 leg */
    const hremote = sdp.create( without( [ 102, 104 ] ) )
    expect( hremote.getmedia( "video" ).rtp.map( ( r ) => r.payload ) ).to.deep.equal( [ 100, 101 ] )
    expect( sdp.choosevideocodec( hremote.getmedia( "video" ) ) ).to.be.undefined
    expect( sdp.choosevideocodec( hremote.getmedia( "video" ), "h264" ) ).to.be.undefined
    expect( sdp.relayablevideocodecs( hremote.getmedia( "video" ) ) ).to.deep.equal( [] )
  } )

  /**
   * chromevideoffer with its video m-line replaced by these h264 fmtp configs
   * (pts 110, 111 ...), optionally followed by vp8 96.
   */
  function h264offer( configs, withvp8 ) {
    const pts = configs.map( ( c, i ) => 110 + i )
    let o = chromevideoffer
      .replace( "m=video 58781 UDP/TLS/RTP/SAVPF 96 102",
        "m=video 58781 UDP/TLS/RTP/SAVPF " + pts.concat( withvp8? [ 96 ]: [] ).join( " " ) )
    o = o.substring( 0, o.indexOf( "a=rtpmap:96 VP8/90000" ) )
    const lines = []
    configs.forEach( ( c, i ) => {
      lines.push( `a=rtpmap:${pts[ i ]} H264/90000` )
      lines.push( `a=fmtp:${pts[ i ]} ${c}` )
    } )
    if( withvp8 ) lines.push( "a=rtpmap:96 VP8/90000" )
    return o + lines.join( "\r\n" )
  }

  /** the video m-line of our answer to offer */
  function answervideo( offer, videocodec ) {
    return sdp.create( sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( sdp.create( offer ), { "videoport": 12002, videocodec } )
      .toString() ).sdp.media[ 1 ]
  }

  const high = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f"
  const mode0 = "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f"

  it( "h264: an offer whose only h264 is High is rejected (port 0)", async function() {
    const offer = h264offer( [ high ] )
    expect( answervideo( offer ).port ).to.equal( 0 )
    expect( answervideo( offer, "h264" ).port ).to.equal( 0 )
    expect( sdp.relayablevideocodecs( sdp.create( offer ).getmedia( "video" ) ) ).to.deep.equal( [] )
  } )

  it( "h264: an offer whose only h264 is packetization-mode=0 is rejected (port 0)", async function() {
    /* also no packetization-mode at all - RFC 6184 default is 0 */
    for( const config of [ mode0, "profile-level-id=42e01f" ] ) {
      const offer = h264offer( [ config ] )
      expect( answervideo( offer ).port ).to.equal( 0 )
      expect( sdp.choosevideocodec( sdp.create( offer ).getmedia( "video" ) ) ).to.be.undefined
    }
  } )

  it( "h264: High (and mode 0) listed first with vp8 falls to vp8", async function() {
    const offer = h264offer( [ high, mode0 ], true )
    const video = answervideo( offer )
    expect( video.port ).to.equal( 12002 )
    expect( video.rtp ).to.have.lengthOf( 1 )
    expect( video.rtp[ 0 ].codec ).to.equal( "VP8" )
    expect( video.rtp[ 0 ].payload ).to.equal( 96 )
    expect( sdp.relayablevideocodecs( sdp.create( offer ).getmedia( "video" ) ) ).to.deep.equal( [ "vp8" ] )
    /* pinned to h264 by the paired leg: nothing relayable, reject */
    expect( answervideo( offer, "h264" ).port ).to.equal( 0 )
  } )

  it( "h264: constrained baseline per RFC 6184 - 4d with constraint_set0, not 4d401f", async function() {
    /* 4d80xx / 4de0xx: Main + constraint_set0 (obeys Baseline) =
       constrained baseline, ranked with 42e0/42c0 above plain baseline */
    for( const cb of [ "4d801f", "4de01f", "58c01f", "42c01f" ] ) {
      const offer = h264offer( [ "packetization-mode=1;profile-level-id=42001f",
        `packetization-mode=1;profile-level-id=${cb}` ] )
      expect( sdp.choosevideocodec( sdp.create( offer ).getmedia( "video" ) ).payload, cb ).to.equal( 111 )
    }

    /* 4d401f is Main with constraint_set1 (obeys Main) - still Main, which a
       constrained-baseline decoder cannot take: not relayable */
    const main = h264offer( [ "packetization-mode=1;profile-level-id=4d401f" ] )
    expect( answervideo( main ).port ).to.equal( 0 )
    const mainvp8 = h264offer( [ "packetization-mode=1;profile-level-id=4d401f" ], true )
    expect( answervideo( mainvp8 ).rtp[ 0 ].codec ).to.equal( "VP8" )
    /* Main with no constraint flags either */
    expect( answervideo( h264offer( [ "packetization-mode=1;profile-level-id=4d001f" ] ) ).port ).to.equal( 0 )
  } )

  it( "h264: an answer to our offer is taken as it stands (answers may omit fmtp)", async function() {
    /* our offer carries 42e01f;packetization-mode=1; a far end answering on
       that PT with no fmtp is still our config, not packetization-mode 0 */
    const answer = h264offer( [ "x-google=1" ] ).replace( /a=fmtp:110 [^\r]*\r\n?/, "" )
    const vm = sdp.create( answer ).getmedia( "video" )
    expect( sdp.choosevideocodec( vm ) ).to.be.undefined
    expect( sdp.choosevideocodec( vm, undefined, true ).payload ).to.equal( 110 )
    expect( sdp.choosevideocodec( vm, "h264", true ).payload ).to.equal( 110 )
    expect( sdp.choosevideocodec( vm, "vp8", true ) ).to.be.undefined
  } )

  it( "an accepted video answer never repeats the offerer's max-fs / max-mbps / max-br", async function() {

    /* in our answer those would say what WE receive - and the relay hands us
       the other leg's stream, which nobody held to this offerer's limits */
    const remote = sdp.create( chromevideoffer
      .replace( "profile-level-id=42001f", "profile-level-id=42001f;max-fs=8160;max-mbps=244800;max-br=20000;max-smbps=244800;max-cpb=25000;max-dpb=32768" )
      .replace( "a=rtpmap:96 VP8/90000", "a=rtpmap:96 VP8/90000\r\na=fmtp:96 max-fs=12288;max-fr=60" ) )

    const h264 = sdp.create( sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002, "videocodec": "h264" } )
      .toString() )
    expect( h264.getmedia( "video" ).fmtp ).to.deep.equal( [
      { "payload": 102, "config": "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f" } ] )

    /* vp8's fmtp is nothing but receive capabilities: no a=fmtp at all */
    const vp8 = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002, "videocodec": "vp8" } )
      .toString()
    expect( vp8 ).to.include( "a=rtpmap:96 VP8/90000" )
    expect( vp8 ).to.not.match( /max-f[sr]/ )
    expect( vp8 ).to.not.include( "a=fmtp:96" )

    /* and the parsed offer is left alone */
    expect( remote.toString() ).to.include( "max-fs=8160" )
  } )

  it( "h264: a Polycom/Cisco-style answer drops max-recv-level, max-rcmd-nalu-size and sprop-*", async function() {

    /* endpoints like these offer mode 0 and mode 1 with level asymmetry: a
       low send level plus max-recv-level, their own SPS/PPS in
       sprop-parameter-sets and a max-rcmd-nalu-size. Mirrored, those would
       claim we receive at level 4.0 above the cap and send their parameter
       sets. */
    const offer = h264offer( [
      "profile-level-id=42801e;packetization-mode=0;max-mbps=108000;max-fs=3600;sprop-parameter-sets=Z0KAHpWgUAW5,aM4G4g==",
      "profile-level-id=42801e;packetization-mode=1;max-recv-level=28;max-rcmd-nalu-size=3456000;" +
        "sprop-parameter-sets=Z0KAHpWgUAW5,aM4G4g==;sprop-level-parameter-sets=Z0KAKJWg;level-asymmetry-allowed=1" ] )

    const answer = sdp.create( sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( sdp.create( offer ), { "videoport": 12002, "videocodec": "h264" } )
      .caph264level( 0x1f )
      .toString() )
    const vm = answer.getmedia( "video" )
    expect( vm.rtp.map( ( r ) => r.payload ) ).to.deep.equal( [ 111 ] )
    expect( vm.fmtp ).to.deep.equal( [
      { "payload": 111, "config": "profile-level-id=42801e;packetization-mode=1;level-asymmetry-allowed=1" } ] )
    expect( answer.toString() ).to.not.match( /max-recv-level|max-rcmd-nalu-size|sprop-/ )
  } )

  it( "h264 level: caph264level lowers only a higher level, keeping profile and packetization-mode", async function() {

    const offer = sdp.create()
      .addcodecs( "pcma h264 vp8" )
      .setaudioport( 12000 )
      .setvideoport( 12002 )
      .caph264level( 0x15 )
      .toString()
    expect( offer ).to.include( "a=fmtp:102 profile-level-id=42e015;packetization-mode=1;level-asymmetry-allowed=1" )

    /* at or under the cap: untouched; no cap: untouched */
    for( const cap of [ 0x1f, 0x28, undefined ] ) {
      expect( sdp.create().addcodecs( "h264" ).setvideoport( 12002 ).caph264level( cap ).toString() )
        .to.include( "profile-level-id=42e01f" )
    }

    /* an answer mirrored from a level 4.0 offer is lowered too */
    const remote = sdp.create( chromevideoffer.replace( "profile-level-id=42001f", "profile-level-id=42e028" ) )
    const answer = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002, "videocodec": "h264" } )
      .caph264level( 0x1f )
      .toString()
    expect( answer ).to.include( "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f" )
    /* and the parsed offer it was built from is left alone */
    expect( sdp.h264level( remote.getmedia( "video" ) ) ).to.equal( 0x28 )
  } )

  it( "h264 level: h264level reads the relayed payload's level, undefined when not declared", async function() {
    const level = ( s ) => sdp.h264level( sdp.create( s ).getmedia( "video" ) )
    expect( level( chromevideoffer ) ).to.equal( 0x1f )
    expect( level( safarih264offer ) ).to.equal( 0x1f ) /* 102 42e01f, not High 640c1f */
    expect( level( chromevideoffer.replace( /\r\na=fmtp:102 [^\r]*/, "" ) ) ).to.equal( undefined )
    expect( level( chromevideoffer.replace( "m=video 58781 UDP/TLS/RTP/SAVPF 96 102", "m=video 58781 UDP/TLS/RTP/SAVPF 96" )
      .replace( /\r\na=rtpmap:102[^]*$/, "" ) ) ).to.equal( undefined )
  } )

  it( "h264 level 1b: read as below 1.1, and written with constraint_set3 as RFC 6184 spells it", async function() {
    const level = ( plid ) => sdp.h264level( sdp.create( chromevideoffer.replace( "profile-level-id=42001f", "profile-level-id=" + plid ) ).getmedia( "video" ) )
    const capped = ( cap ) => sdp.create().addcodecs( "h264" ).setvideoport( 12002 ).caph264level( cap ).toString()

    /* level_idc 11 is 1b with constraint_set3, 1.1 without */
    expect( level( "42f00b" ) ).to.equal( sdp.h264level1b )
    expect( level( "42e00b" ) ).to.equal( 0x0b )
    expect( sdp.h264level1b ).to.be.above( 0x0a ).and.below( 0x0b )

    /* our 42e01f held to 1b is 42f00b - not 42e00b, which is 1.1 */
    expect( capped( sdp.h264level1b ) ).to.include( "profile-level-id=42f00b;" )
    /* and below 1b, constraint_set3 goes again (42e00a, not 42f00a) */
    const from1b = sdp.create( chromevideoffer.replace( "profile-level-id=42001f", "profile-level-id=42f00b" ) )
    const answer = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( from1b, { "videoport": 12002, "videocodec": "h264" } )
    expect( answer.caph264level( 0x1f ).toString() ).to.include( "profile-level-id=42f00b" )
    expect( answer.caph264level( 0x0a ).toString() ).to.include( "profile-level-id=42e00a" )
  } )

  it( "rtcp-fb: our video offer carries nack, nack pli and ccm fir per codec, and nothing else", async function() {

    const out = sdp.create()
      .addcodecs( "pcma h264 vp8" )
      .setaudioport( 12000 )
      .setvideoport( 12002 )
      .toString()

    const fb = out.split( "\r\n" ).filter( ( l ) => l.startsWith( "a=rtcp-fb:" ) )
    expect( fb ).to.have.members( [
      "a=rtcp-fb:102 nack", "a=rtcp-fb:102 nack pli", "a=rtcp-fb:102 ccm fir",
      "a=rtcp-fb:96 nack", "a=rtcp-fb:96 nack pli", "a=rtcp-fb:96 ccm fir"
    ] )
    expect( fb ).to.have.lengthOf( 6 )
    /* feedback belongs to the video m-line only */
    expect( out.split( "m=video" )[ 0 ] ).to.not.include( "a=rtcp-fb" )
  } )

  it( "rtcp-fb: the answer carries only what the offer offered for the chosen pt, never remb/transport-cc", async function() {

    /* vp8 96 offers all three - all three come back */
    const remote = sdp.create( chromevideoffer )
    const video = sdp.create( sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002 } )
      .toString() ).sdp.media[ 1 ]
    expect( video.rtcpFb.map( ( f ) => `${f.payload} ${f.type} ${f.subtype || ""}`.trim() ) )
      .to.have.members( [ "96 nack", "96 nack pli", "96 ccm fir" ] )

    /* h264 102 offers nack pli + remb + transport-cc (and vp8's lines, which
       must not leak onto 102): answer is nack pli only */
    const offer = chromevideoffer.replace( "profile-level-id=42001f",
      "profile-level-id=42001f\r\na=rtcp-fb:102 nack pli\r\na=rtcp-fb:102 goog-remb\r\na=rtcp-fb:102 transport-cc" )
    const hvideo = sdp.create( sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( sdp.create( offer ), { "videoport": 12002, "videocodec": "h264" } )
      .toString() ).sdp.media[ 1 ]
    expect( hvideo.rtp[ 0 ].payload ).to.equal( 102 )
    expect( hvideo.rtcpFb ).to.have.lengthOf( 1 )
    expect( hvideo.rtcpFb[ 0 ] ).to.include( { "type": "nack", "subtype": "pli" } )
    expect( String( hvideo.rtcpFb[ 0 ].payload ) ).to.equal( "102" )

    /* an offer with no feedback gets none back */
    const nofb = chromevideoffer.replace( /a=rtcp-fb:[^\r]*\r\n/g, "" )
    const nvideo = sdp.create( sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( sdp.create( nofb ), { "videoport": 12002 } )
      .toString() ).sdp.media[ 1 ]
    expect( nvideo.rtcpFb ).to.be.undefined
  } )
  /* Chrome's video m-line: header extensions, transport-cc / goog-remb
     feedback, rtx, a wildcard */
  const chromeextoffer = chromevideoffer.replace( "a=rtcp-fb:96 nack\r\n", [
    "a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
    "a=extmap:4 urn:3gpp:video-orientation",
    "a=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
    "a=extmap-allow-mixed",
    "a=rtcp-fb:96 goog-remb",
    "a=rtcp-fb:96 transport-cc",
    "a=rtcp-fb:* transport-cc",
    "a=rtcp-fb:96 nack",
    ""
  ].join( "\r\n" ) ).replace( "m=video 58781 UDP/TLS/RTP/SAVPF 96 102", "m=video 58781 UDP/TLS/RTP/SAVPF 96 97 102" )
    .replace( "a=rtpmap:102 H264/90000", "a=rtpmap:97 rtx/90000\r\na=fmtp:97 apt=96\r\na=rtpmap:102 H264/90000" )

  it( "rtx / red / ulpfec / flexfec: never negotiated on video, in our answer or our offer", async function() {

    /* The relay rewrites every inbound video PT to the one PT it relays, so a
       retransmission (rtx, apt=), redundancy (red) or FEC (ulpfec/flexfec)
       packet would reach the far end labelled as media and decode as garbage.
       Chrome offers all of them; none may survive into what we write. */
    const fecoffer = chromevideoffer
      .replace( "m=video 58781 UDP/TLS/RTP/SAVPF 96 102", "m=video 58781 UDP/TLS/RTP/SAVPF 96 97 102 103 116 117 118 35" )
      .replace( "a=rtpmap:102 H264/90000", [
        "a=rtpmap:97 rtx/90000",
        "a=fmtp:97 apt=96",
        "a=rtpmap:116 red/90000",
        "a=rtpmap:117 rtx/90000",
        "a=fmtp:117 apt=116",
        "a=rtpmap:118 ulpfec/90000",
        "a=rtpmap:35 flexfec-03/90000",
        "a=rtcp-fb:35 transport-cc",
        "a=fmtp:35 repair-window=10000000",
        "a=rtpmap:102 H264/90000" ].join( "\r\n" ) ) +
      "\r\na=rtpmap:103 rtx/90000\r\na=fmtp:103 apt=102"

    const remote = sdp.create( fecoffer )
    expect( remote.getmedia( "video" ).rtp.map( ( r ) => r.codec.toLowerCase() ) )
      .to.include.members( [ "rtx", "red", "ulpfec", "flexfec-03" ] )

    const outs = []
    for( const videocodec of [ undefined, "vp8", "h264" ] ) {
      outs.push( sdp.create()
        .addcodecs( "pcma" )
        .setaudioport( 12000 )
        .mirrormedia( remote, { "videoport": 12002, videocodec } )
        .toString() )
    }
    outs.push( sdp.create().addcodecs( "pcma h264 vp8" ).setaudioport( 12000 ).setvideoport( 12002 ).toString() )

    for( const out of outs ) {
      const video = "m=video" + out.split( "m=video" )[ 1 ]
      expect( video ).to.not.match( /rtx|red\/|ulpfec|flexfec|apt=|repair-window/i )
      /* every payload on the m-line is one the relay carries */
      const pts = video.match( /^m=video \d+ \S+ ([0-9 ]+)$/m )[ 1 ].split( " " )
      for( const pt of pts ) expect( video ).to.match( new RegExp( `^a=rtpmap:${pt} (VP8|H264)/90000$`, "m" ) )
    }
    /* and the answers each carry exactly one payload */
    for( const out of outs.slice( 0, 3 ) ) {
      expect( out ).to.match( /^m=video 12002 \S+ \d+$/m )
    }
  } )

  it( "extmap / feedback: neither our answer nor our offer carries header extensions or feedback the relay cannot honour", async function() {

    const remote = sdp.create( chromeextoffer )
    expect( remote.getmedia( "video" ).ext ).to.have.lengthOf( 3 )

    const answer = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( remote, { "videoport": 12002 } )
      .addssrc( 1122334455, { "video": 5544332211 } )
      .secure( "AA:BB", "passive" )
      .addicecandidates( "127.0.0.1", 12000, "pwd", { "video": { "port": 12002, "icepwd": "vpwd" } } )
      .rtcpmux()
      .toString()

    const offer = sdp.create()
      .addcodecs( "pcma h264 vp8" )
      .setaudioport( 12000 )
      .setvideoport( 12002 )
      .addssrc( 1122334455, { "video": 5544332211 } )
      .secure( "AA:BB", "actpass" )
      .addicecandidates( "127.0.0.1", 12000, "pwd", { "video": { "port": 12002, "icepwd": "vpwd" } } )
      .rtcpmux()
      .toString()

    for( const out of [ answer, offer ] ) {
      expect( out ).to.include( "m=video 12002" )
      expect( out ).to.not.include( "a=extmap" )
      expect( out ).to.not.include( "transport-cc" )
      expect( out ).to.not.include( "goog-remb" )
      expect( out ).to.not.match( /rtx\/90000/i )
      /* only nack / nack pli / ccm fir */
      for( const l of out.split( "\r\n" ).filter( ( l ) => l.startsWith( "a=rtcp-fb:" ) ) ) {
        expect( l ).to.match( /^a=rtcp-fb:\d+ (nack|nack pli|ccm fir)$/ )
      }
    }
    /* the answer accepted vp8 96 with exactly the three it can honour */
    const fb = answer.split( "\r\n" ).filter( ( l ) => l.startsWith( "a=rtcp-fb:" ) )
    expect( fb ).to.have.members( [ "a=rtcp-fb:96 nack", "a=rtcp-fb:96 nack pli", "a=rtcp-fb:96 ccm fir" ] )
  } )

  /* ---- several / disabled video m-lines (VIDEO-WAITING-ROOM-2 gap 4) ---- */

  /* chrome's offer plus a screen share: a second video m-line, mid 2 */
  const screenshareoffer = chromevideoffer + "\r\n" + [
    "m=video 58783 UDP/TLS/RTP/SAVPF 96",
    "a=candidate:1 1 udp 2113937151 192.168.0.50 58783 typ host generation 0",
    "a=ice-ufrag:F7gI",
    "a=ice-pwd:x9cml/YzichV2+XlhiMu8g",
    "a=setup:actpass",
    "a=mid:2",
    "a=sendonly",
    "a=rtcp-mux",
    "a=rtpmap:96 VP8/90000" ].join( "\r\n" )

  /**
   * @param { string } offer
   * @param { number } [ videoport ]
   * @returns { object } our answer, decorated as call.js does for webrtc
   */
  function webrtcanswer( offer, videoport = 12002 ) {
    return sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( sdp.create( offer ), { videoport } )
      .addssrc( 111111, { "video": 222222 } )
      .secure( "AA:BB:CC", "passive" )
      .addicecandidates( "10.0.0.1", 12000, "audiopwd", { "video": { "port": videoport, "icepwd": "videopwd" } } )
      .rtcpmux()
  }

  it( "a second video m-line (screen share) is rejected with port 0; only the first is accepted", async function() {

    const reparsed = sdp.create( webrtcanswer( screenshareoffer ).toString() ).sdp

    expect( reparsed.media.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video", "video" ] )
    expect( reparsed.media.map( ( m ) => m.port ) ).to.deep.equal( [ 12000, 12002, 0 ] )
    expect( reparsed.media.map( ( m ) => String( m.mid ) ) ).to.deep.equal( [ "0", "1", "2" ] )
    expect( sdp.create( screenshareoffer ).getrelayvideo().mid ).to.equal( 1 )
  } )

  it( "an offered port-0 video m-line is answered with port 0, and the live one after it is the one accepted", async function() {

    const disabledfirst = screenshareoffer.replace( "m=video 58781", "m=video 0" )
    const offer = sdp.create( disabledfirst )
    expect( offer.getrelayvideo().mid ).to.equal( 2 )
    expect( offer.getvideo( offer.getrelayvideo() ).port ).to.equal( 58783 )

    const reparsed = sdp.create( webrtcanswer( disabledfirst ).toString() ).sdp
    expect( reparsed.media.map( ( m ) => m.port ) ).to.deep.equal( [ 12000, 0, 12002 ] )
    /* the accepted one mirrors the offer's sendonly */
    expect( reparsed.media[ 2 ].direction ).to.equal( "recvonly" )

    /* and with nothing live, nothing is accepted */
    const alldisabled = disabledfirst.replace( "m=video 58783", "m=video 0" )
    const none = sdp.create( webrtcanswer( alldisabled ).toString() ).sdp
    expect( none.media.map( ( m ) => m.port ) ).to.deep.equal( [ 12000, 0, 0 ] )
  } )

  it( "rejected m-lines carry no ssrc, msid or candidates - the audio's least of all", async function() {

    const out = webrtcanswer( screenshareoffer ).toString()
    const reparsed = sdp.create( out ).sdp
    const rejected = reparsed.media[ 2 ]
    expect( rejected.port ).to.equal( 0 )
    expect( rejected.ssrcs ).to.be.undefined
    expect( rejected.msid ).to.be.undefined
    expect( rejected.candidates ).to.be.undefined
    expect( rejected.icePwd ).to.be.undefined
    expect( out.split( "m=video 0" )[ 1 ] ).to.not.include( "111111" )

    /* the live ones are decorated as before */
    expect( reparsed.media[ 0 ].ssrcs.every( ( s ) => 111111 === s.id ) ).to.be.true
    expect( reparsed.media[ 1 ].ssrcs.every( ( s ) => 222222 === s.id ) ).to.be.true
    expect( reparsed.media[ 1 ].candidates[ 0 ].port ).to.equal( 12002 )

    /* video rejected outright (no port): the video m-line carries nothing either */
    const novideo = sdp.create( webrtcanswer( chromevideoffer, 0 ).toString() ).sdp
    expect( novideo.media[ 1 ].port ).to.equal( 0 )
    expect( novideo.media[ 1 ].ssrcs ).to.be.undefined
    expect( novideo.media[ 1 ].candidates ).to.be.undefined
  } )

  it( "the accepted video m-line mirrors the offer's direction (RFC 3264 6.1)", async function() {

    for( const [ offered, answered ] of [ [ "sendrecv", "sendrecv" ], [ "sendonly", "recvonly" ],
      [ "recvonly", "sendonly" ], [ "inactive", "inactive" ] ] ) {
      const offer = chromevideoffer.replace( /a=mid:1\r\na=sendrecv/, "a=mid:1\r\na=" + offered )
      const reparsed = sdp.create( webrtcanswer( offer ).toString() ).sdp
      expect( reparsed.media[ 1 ].direction ).to.equal( answered )
    }
  } )

  it( "a re-answer keeps our audio m-line and our live video transport, answering an added m-line with port 0", async function() {

    const first = webrtcanswer( chromevideoffer )
    const before = sdp.create( first.toString() ).sdp

    /* the same session re-offered with a screen share added */
    first.mirrormedia( sdp.create( screenshareoffer ), { "videoport": 12002 } )
    const after = sdp.create( first.toString() ).sdp

    expect( after.media.map( ( m ) => m.port ) ).to.deep.equal( [ 12000, 12002, 0 ] )
    /* no ICE restart, same ssrc on the video leg */
    expect( after.media[ 1 ].iceUfrag ).to.equal( before.media[ 1 ].iceUfrag )
    expect( after.media[ 1 ].icePwd ).to.equal( "videopwd" )
    expect( after.media[ 1 ].ssrcs ).to.deep.equal( before.media[ 1 ].ssrcs )
    expect( after.media[ 0 ].iceUfrag ).to.equal( before.media[ 0 ].iceUfrag )
    expect( after.media[ 2 ].candidates ).to.be.undefined
  } )

  it( "preservemlines: a re-offer keeps every m-line, in order, with its mid - what we no longer carry disabled with port 0", async function() {

    /* the dialog so far: audio, video (live), video (rejected screen share) */
    const previous = webrtcanswer( screenshareoffer )
    previous.toString() /* toString rewrites payloads as strings - handled */

    /* our fresh re-offer: audio only (the video leg idle-closed) */
    const reoffer = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 14000 )
      .preservemlines( previous )
    const reparsed = sdp.create( reoffer.toString() ).sdp

    expect( reparsed.media.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video", "video" ] )
    expect( reparsed.media.map( ( m ) => m.port ) ).to.deep.equal( [ 14000, 0, 0 ] )
    expect( reparsed.media.map( ( m ) => String( m.mid ) ) ).to.deep.equal( [ "0", "1", "2" ] )
    expect( reparsed.media[ 1 ].protocol ).to.equal( "UDP/TLS/RTP/SAVPF" )
    expect( reparsed.media[ 1 ].payloads ).to.deep.equal( [ 96 ] )
    /* same session, next version */
    expect( reparsed.origin.sessionId ).to.equal( previous.sdp.origin.sessionId )
    expect( reparsed.origin.sessionVersion ).to.equal( previous.sdp.origin.sessionVersion + 1 )

    /* with video still carried it takes the live video slot, not the rejected one */
    const withvideo = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 14000 )
      .addcodecs( "vp8" )
      .setvideoport( 14002 )
      .preservemlines( previous )
    expect( withvideo.sdp.media.map( ( m ) => m.port ) ).to.deep.equal( [ 14000, 14002, 0 ] )
    expect( withvideo.sdp.media.map( ( m ) => String( m.mid ) ) ).to.deep.equal( [ "0", "1", "2" ] )

    /* an m-line the dialog never had is appended; no previous leaves it alone */
    const grown = sdp.create().addcodecs( "pcma" ).setaudioport( 14000 ).addcodecs( "vp8" ).setvideoport( 14002 )
      .preservemlines( sdp.create().addcodecs( "pcma" ).setaudioport( 12000 ) )
    expect( grown.sdp.media.map( ( m ) => m.type ) ).to.deep.equal( [ "audio", "video" ] )
    const untouched = sdp.create().addcodecs( "pcma" ).setaudioport( 14000 ).preservemlines( undefined )
    expect( untouched.sdp.media ).to.have.lengthOf( 1 )
  } )
} )

/*
Our own video receive limits (VIDEO-WAITING-ROOM): what the projectrtp relay
leg enforces, advertised so a sender that honours it stays under it (browsers
honour the bitrate lines only). Distinct from
stripreceivercaps above, which removes the OFFERER's caps from a mirrored
answer: these are ours, added afterwards.
*/
describe( "sdp video limits", function() {

  /* the callmanager defaults (lib/call.js videolimitdefaults) */
  const defaults = { "bitrate": 2000000, "framerate": 30, "maxfs": 3600 }
  const lowered = { "bitrate": 1000000, "framerate": 15, "maxfs": 1200 }

  /** the text of each m-section of an SDP string, by m-line */
  function sections( s ) {
    return s.split( /\r\n(?=m=)/ ).slice( 1 )
  }

  /** the b= lines of a section */
  function blines( section ) {
    return section.split( "\r\n" ).filter( ( l ) => l.startsWith( "b=" ) )
  }

  /** our offer: pcma + h264 + vp8, video on 12002 */
  function ouroffer( limits, h264cap = 0x1f ) {
    return sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .addcodecs( "h264 vp8" )
      .setvideoport( 12002 )
      .caph264level( h264cap )
      .setvideolimits( limits )
  }

  /** our answer to offer, accepting videocodec on 12002 */
  function ouranswer( offer, videocodec, limits, h264cap = 0x1f ) {
    return sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( sdp.create( offer ), { "videoport": 12002, videocodec } )
      .caph264level( h264cap )
      .setvideolimits( limits )
  }

  it( "an offer carries b=AS then b=TIAS just under the cap, a=framerate and vp8 max-fs/max-fr on video - nothing on audio", async function() {

    const out = ouroffer( defaults ).toString()
    const [ audio, video ] = sections( out )

    /* TIAS last: libwebrtc keeps the last b= line it reads */
    expect( blines( video ) ).to.deep.equal( [ "b=AS:1800", "b=TIAS:1700000" ] )
    expect( video ).to.match( /^a=framerate:30$/m )
    expect( video ).to.match( /^a=fmtp:96 max-fs=3600;max-fr=30$/m )
    /* the defaults are exactly level 3.1: our h264 is unchanged */
    expect( video ).to.match( /^a=fmtp:102 profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1$/m )

    expect( blines( audio ) ).to.deep.equal( [] )
    expect( audio ).to.not.include( "a=framerate" )
    expect( audio ).to.not.include( "max-f" )
    /* and no session-level b= */
    expect( out.split( "m=audio" )[ 0 ] ).to.not.include( "b=" )
  } )

  it( "the advertised bitrate stays under the relay's cap, headers and retransmissions included", async function() {
    for( const bitrate of [ 2000000, 1000000, 300000, 64000 ] ) {
      const video = sections( ouroffer( { ...defaults, bitrate } ).toString() )[ 1 ]
      const as = Number( video.match( /^b=AS:(\d+)$/m )[ 1 ] )
      const tias = Number( video.match( /^b=TIAS:(\d+)$/m )[ 1 ] )
      expect( tias ).to.equal( Math.floor( bitrate * 0.85 ) )
      expect( as ).to.equal( Math.floor( bitrate * 0.9 / 1000 ) )
      /* AS (overhead-inclusive) above TIAS (media only), both under the cap */
      expect( as * 1000 ).to.be.above( tias )
      expect( as * 1000 ).to.be.below( bitrate )
    }
  } )

  it( "an answer carries our limits on the accepted video m-line, vp8 and h264 alike", async function() {

    const vp8 = ouranswer( chromevideoffer, "vp8", defaults ).toString()
    const [ audio, video ] = sections( vp8 )
    expect( blines( video ) ).to.deep.equal( [ "b=AS:1800", "b=TIAS:1700000" ] )
    expect( video ).to.match( /^a=fmtp:96 max-fs=3600;max-fr=30$/m )
    expect( video ).to.match( /^a=framerate:30$/m )
    expect( blines( audio ) ).to.deep.equal( [] )

    const h264 = sections( ouranswer( chromevideoffer, "h264", defaults ).toString() )[ 1 ]
    expect( blines( h264 ) ).to.deep.equal( [ "b=AS:1800", "b=TIAS:1700000" ] )
    expect( h264 ).to.match( /^a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f$/m )
  } )

  it( "the offerer's own max-fs / max-fr / max-mbps are still stripped, then ours added", async function() {

    const offer = chromevideoffer
      .replace( "profile-level-id=42001f", "profile-level-id=42001f;max-fs=8160;max-mbps=244800;max-br=20000" )
      .replace( "a=rtpmap:96 VP8/90000", "a=rtpmap:96 VP8/90000\r\na=fmtp:96 max-fs=12288;max-fr=60" )

    const vp8 = sections( ouranswer( offer, "vp8", lowered ).toString() )[ 1 ]
    expect( vp8.split( "\r\n" ).filter( ( l ) => l.startsWith( "a=fmtp:" ) ) )
      .to.deep.equal( [ "a=fmtp:96 max-fs=1200;max-fr=15" ] )

    /* h264: the offerer's receive caps gone, our level and caps in their place */
    const h264 = sections( ouranswer( offer, "h264", lowered ).toString() )[ 1 ]
    expect( h264.split( "\r\n" ).filter( ( l ) => l.startsWith( "a=fmtp:" ) ) ).to.deep.equal( [
      "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=420014;max-fs=1200;max-mbps=18000" ] )
    expect( h264 ).to.not.match( /8160|244800|max-br/ )

    /* with no limits of ours, the answer carries no caps at all */
    const none = ouranswer( offer, "vp8", { "bitrate": 0, "framerate": 0, "maxfs": 0 } ).toString()
    expect( none ).to.not.match( /max-f[sr]|^b=|a=framerate/m )
    expect( none ).to.not.include( "a=fmtp:96" )
  } )

  it( "lowered limits lower everything: bandwidth, vp8 caps, framerate and the h264 level", async function() {

    const video = sections( ouroffer( lowered ).toString() )[ 1 ]
    expect( blines( video ) ).to.deep.equal( [ "b=AS:900", "b=TIAS:850000" ] )
    expect( video ).to.match( /^a=framerate:15$/m )
    expect( video ).to.match( /^a=fmtp:96 max-fs=1200;max-fr=15$/m )
    /* 1200 MB at 15 fps: level 2 (396 MB, 11880 MB/s) is the highest level
       within both; RFC 6184 max-fs/max-mbps raise it back to the limits */
    expect( video ).to.match( /^a=fmtp:102 profile-level-id=42e014;packetization-mode=1;level-asymmetry-allowed=1;max-fs=1200;max-mbps=18000$/m )
  } )

  it( "h264 level: the highest level within maxfs and maxfs x framerate, bitrate playing no part", async function() {
    const level = sdp.h264levelforlimits
    expect( level( 3600, 30 ) ).to.equal( 0x1f ) /* 720p30 = 3.1 */
    expect( level( 3600, 15 ) ).to.equal( 0x1e ) /* 54000 MB/s: 3.0 */
    expect( level( 1200, 15 ) ).to.equal( 0x14 )
    expect( level( 1620, 25 ) ).to.equal( 0x1e ) /* 625 lines at 25: exactly 3.0 */
    expect( level( 396, 30 ) ).to.equal( 0x14 ) /* CIF at 30: level 2 (1.3 and 2 share limits) */
    expect( level( 99, 15 ) ).to.equal( 0x0a ) /* level 1, never 1b */
    expect( level( 50, 15 ) ).to.equal( 0x0a ) /* nothing smaller than level 1 */
    expect( level( 3600, 0 ) ).to.equal( 0x1f ) /* framerate unlimited: frame size alone */
    expect( level( 0, 30 ) ).to.be.undefined /* frame size unlimited: no level cap */

    /* 3.0 lowered from 3.1 with frame size to spare: max-fs/max-mbps restore it */
    const video = sections( ouroffer( { ...defaults, "framerate": 15 } ).toString() )[ 1 ]
    expect( video ).to.match( /^a=fmtp:102 profile-level-id=42e01e;packetization-mode=1;level-asymmetry-allowed=1;max-fs=3600;max-mbps=54000$/m )
  } )

  it( "h264: limits never raise a level, nor max-fs/max-mbps past what the m-line declared before", async function() {

    /* the paired leg decodes only 2.1 (792 MB, 19800 MB/s): caph264level
       has already lowered us there, and our limits must not undo it */
    const video = sections( ouroffer( lowered, 0x15 ).toString() )[ 1 ]
    expect( video ).to.match( /^a=fmtp:102 profile-level-id=42e014;packetization-mode=1;level-asymmetry-allowed=1;max-fs=792;max-mbps=18000$/m )

    /* already at or under the limits' level: left alone */
    const low = sections( ouroffer( lowered, 0x0d ).toString() )[ 1 ]
    expect( low ).to.match( /^a=fmtp:102 profile-level-id=42e00d;packetization-mode=1;level-asymmetry-allowed=1$/m )

    /* generous limits do not lift our registry's 3.1 */
    const big = sections( ouroffer( { "bitrate": 8000000, "framerate": 60, "maxfs": 8160 } ).toString() )[ 1 ]
    expect( big ).to.match( /^a=fmtp:102 profile-level-id=42e01f;packetization-mode=1;level-asymmetry-allowed=1$/m )
    expect( big ).to.match( /^a=fmtp:96 max-fs=8160;max-fr=60$/m )
  } )

  it( "a re-offer and a re-answer carry the limits again; a hold keeps them", async function() {

    const first = ouroffer( defaults )
    first.toString()
    const reoffer = ouroffer( lowered ).preservemlines( first ).toString()
    const video = sections( reoffer )[ 1 ]
    expect( blines( video ) ).to.deep.equal( [ "b=AS:900", "b=TIAS:850000" ] )
    expect( video ).to.match( /^a=fmtp:96 max-fs=1200;max-fr=15$/m )

    /* a re-answer rebuilds the video m-line from the new offer */
    const answer = ouranswer( chromevideoffer, "vp8", defaults )
    answer.mirrormedia( sdp.create( chromevideoffer ), { "videoport": 12002, "videocodec": "vp8" } )
      .caph264level( 0x1f )
      .setvideolimits( defaults )
      .setvideolimits( defaults ) /* idempotent */
    const reanswer = sections( answer.toString() )[ 1 ]
    expect( blines( reanswer ) ).to.deep.equal( [ "b=AS:1800", "b=TIAS:1700000" ] )
    expect( reanswer.split( "\r\n" ).filter( ( l ) => l.startsWith( "a=fmtp:" ) ) )
      .to.deep.equal( [ "a=fmtp:96 max-fs=3600;max-fr=30" ] )
    expect( reanswer.match( /a=framerate/g ) ).to.have.lengthOf( 1 )

    /* hold only changes the direction */
    const held = ouroffer( defaults ).setvideodirection( "inactive" ).toString()
    expect( blines( sections( held )[ 1 ] ) ).to.deep.equal( [ "b=AS:1800", "b=TIAS:1700000" ] )
  } )

  it( "a maxfs under 99 is raised to 99 (H.264 level 1), so vp8 and h264 both declare exactly what the relay enforces; fractions are rounded down", async function() {

    const video = sections( ouroffer( { "bitrate": 300000, "framerate": 15.9, "maxfs": 40 } ).toString() )[ 1 ]
    expect( video ).to.match( /^a=fmtp:96 max-fs=99;max-fr=15$/m )
    expect( video ).to.match( /^a=framerate:15$/m )
    /* level 1 is 99 MB at 1485 MB/s = 99 x 15: exactly the limits, nothing to raise */
    expect( video ).to.match( /^a=fmtp:102 profile-level-id=42e00a;packetization-mode=1;level-asymmetry-allowed=1$/m )

    /* at 30 fps level 1's MaxMBPS is short, so max-mbps raises it - but
       max-fs stays level 1's 99, never above it */
    const thirty = sections( ouroffer( { "bitrate": 300000, "framerate": 30, "maxfs": 98 } ).toString() )[ 1 ]
    expect( thirty ).to.match( /^a=fmtp:96 max-fs=99;max-fr=30$/m )
    expect( thirty ).to.match( /^a=fmtp:102 profile-level-id=42e00a;packetization-mode=1;level-asymmetry-allowed=1;max-mbps=2970$/m )

    /* 99 and up are untouched; 0 is still unlimited */
    expect( sections( ouroffer( { ...defaults, "maxfs": 99 } ).toString() )[ 1 ] ).to.match( /^a=fmtp:96 max-fs=99;max-fr=30$/m )
    expect( sections( ouroffer( { ...defaults, "maxfs": 0 } ).toString() )[ 1 ] ).to.match( /^a=fmtp:96 max-fr=30$/m )
  } )

  it( "a rejected (port 0) video m-line carries no limits", async function() {
    const out = sdp.create()
      .addcodecs( "pcma" )
      .setaudioport( 12000 )
      .mirrormedia( sdp.create( chromevideoffer ), {} )
      .setvideolimits( defaults )
      .toString()
    const video = sections( out )[ 1 ]
    expect( video ).to.match( /^m=video 0 / )
    expect( blines( video ) ).to.deep.equal( [] )
    expect( video ).to.not.match( /framerate|max-f/ )
  } )
} )
