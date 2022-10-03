

const expect = require( "chai" ).expect
const sdp = require( "../../lib/sdp.js" )
const call = require( "../../lib/call.js" )

describe( "sdp", function() {

  it( `create new sdp object`, async function() {
    let s = sdp.create()

    /* check basic strcture */
    expect( s.sdp ).to.have.property( "version" ).that.is.a( "number" ).to.equal( 0 )
    expect( s.sdp ).to.have.property( "origin" ).that.is.a( "object" )
    expect( s.sdp ).to.have.property( "name" ).that.is.a( "string" ).to.equal( "project" )
    expect( s.sdp ).to.have.property( "timing" ).that.is.a( "object" )
    expect( s.sdp ).to.have.property( "connection" ).that.is.a( "object" )
    expect( s.sdp ).to.have.property( "media" ).that.is.a( "array" ).to.have.lengthOf( 1 )
  } )

  it( `pcma intersection`, async function() {

    let testsdp = `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 8 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    expect( sdp.create( testsdp ).intersection( "pcma pcmu" ) ).to.equal( "pcma" )

  } )

  it( `pcma intersection`, async function() {

    let testsdp = `v=0
o=Z 1608236465345 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 56802 RTP/AVP 8 0 9 97 106 101 98
a=rtpmap:97 iLBC/8000
a=fmtp:97 mode=20
a=rtpmap:106 opus/48000/2
a=fmtp:106 minptime=20; cbr=1; maxaveragebitrate=40000; useinbandfec=1
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    expect( sdp.create( testsdp ).intersection( "pcma pcmu" ) ).to.equal( "pcma pcmu" )
    expect( sdp.create( testsdp ).intersection( "pcma pcmu", true ) ).to.equal( "pcma" )
    expect( sdp.create( testsdp ).intersection( "pcmu pcma", true ) ).to.equal( "pcmu" )
    expect( sdp.create( testsdp ).intersection( "ilbc pcmu" ) ).to.equal( "ilbc pcmu" )
    expect( sdp.create( testsdp ).intersection( [ 97, 0 ] ) ).to.equal( "ilbc pcmu" )

  } )

  it( `generate sdp from object pcma`, async function() {

    /* Setsession id only to permorm the test - normally use the default changing one */
    let newsdp = sdp.create().setsessionid( 0 ).addcodecs( "pcma" ).setconnectionaddress( "192.168.0.100" ).toString()

    expect( newsdp ).to.equal( "v=0\r\n" +
      "o=- 0 0 IN IP4 127.0.0.1\r\n" +
      "s=project\r\n" +
      "c=IN IP4 192.168.0.100\r\n" +
      "t=0 0\r\n" +
      "m=audio 0 RTP/AVP 8\r\n" +
      "a=rtpmap:8 PCMA/8000\r\n" +
      "a=ptime:20\r\n" +
      "a=sendrecv\r\n" )
  } )

  it( `generate sdp from object ilbc pcma`, async function() {
    let newsdp = sdp.create().setsessionid( 0 ).addcodecs( "ilbc pcma" ).toString()

    expect( newsdp ).to.equal( "v=0\r\n" +
      "o=- 0 0 IN IP4 127.0.0.1\r\n" +
      "s=project\r\n" +
      "c=IN IP4 127.0.0.1\r\n" +
      "t=0 0\r\n" +
      "m=audio 0 RTP/AVP 97 8\r\n" +
      "a=rtpmap:97 ilbc/8000\r\n" +
      "a=rtpmap:8 PCMA/8000\r\n" +
      "a=fmtp:97 mode=20\r\n" +
      "a=ptime:20\r\n" +
      "a=sendrecv\r\n" )
  } )

  it( `don't duplicate codec request`, async function() {

    let newsdp = sdp.create().setsessionid( 0 ).addcodecs( "ilbc ilbc pcma" ).toString()

    expect( newsdp ).to.equal( "v=0\r\n" +
      "o=- 0 0 IN IP4 127.0.0.1\r\n" +
      "s=project\r\n" +
      "c=IN IP4 127.0.0.1\r\n" +
      "t=0 0\r\n" +
      "m=audio 0 RTP/AVP 97 8\r\n" +
      "a=rtpmap:97 ilbc/8000\r\n" +
      "a=rtpmap:8 PCMA/8000\r\n" +
      "a=fmtp:97 mode=20\r\n" +
      "a=ptime:20\r\n" +
      "a=sendrecv\r\n" )
  } )

  it( `exclude a ptime of 30`, async function() {

    let testsdp = `v=0
o=Z 1608292844058 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 56802 RTP/AVP 8 0 9 106 101 98 97
a=rtpmap:106 opus/48000/2
a=fmtp:106 minptime=20; cbr=1; maxaveragebitrate=40000; useinbandfec=1
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=rtpmap:97 iLBC/8000
a=fmtp:97 mode=30
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    expect( sdp.create( testsdp ).intersection( "ilbc pcmu" ) ).to.equal( "pcmu" )

  } )

  it( `looking for pcma`, async function() {

    let testsdp = `v=0
o=Z 1608303841226 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 56802 RTP/AVP 8 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`

    expect( sdp.create( testsdp ).intersection( "pcmu pcma" ) ).to.equal( "pcma" )
  } )

  it( `looking for g722`, async function() {

    let testsdp = `v=0
o=Z 1610744131900 1 IN IP4 127.0.0.1
s=Z
c=IN IP4 127.0.0.1
t=0 0
m=audio 56858 RTP/AVP 106 9 98 101 0 8 18 3
a=rtpmap:106 opus/48000/2
a=fmtp:106 maxplaybackrate=16000; sprop-maxcapturerate=16000; minptime=20; cbr=1; maxaveragebitrate=20000; useinbandfec=1
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    let remote = sdp.create( testsdp )
    expect( remote.intersection( "g722 pcmu", true ) ).to.equal( "g722" )

    remote.setaudiodirection( "inactive" )
    expect( remote.toString() ).to.equal(
      "v=0\r\n" +
      "o=Z 1610744131900 1 IN IP4 127.0.0.1\r\n" +
      "s=Z\r\n" +
      "c=IN IP4 127.0.0.1\r\n" +
      "t=0 0\r\n" +
      "m=audio 56858 RTP/AVP 106 9 98 101 0 8 18 3\r\n" +
      "a=rtpmap:106 opus/48000/2\r\n" +
      "a=rtpmap:98 telephone-event/48000\r\n" +
      "a=rtpmap:101 telephone-event/8000\r\n" +
      "a=rtpmap:18 G729/8000\r\n" +
      "a=fmtp:106 maxplaybackrate=16000; sprop-maxcapturerate=16000; minptime=20; cbr=1; maxaveragebitrate=20000; useinbandfec=1\r\n" +
      "a=fmtp:98 0-16\r\n" +
      "a=fmtp:101 0-16\r\n" +
      "a=fmtp:18 annexb=no\r\n" +
      "a=inactive\r\n"
    )
  } )

  it( `sdp member functions`, async function() {
    let testsdp = `v=0
o=Z 1610744131900 1 IN IP4 127.0.0.1
s=Z
c=IN IP4 192.168.0.100
t=0 0
m=audio 56858 RTP/AVP 106 9 98 101 0 8 18 3
a=rtpmap:106 opus/48000/2
a=fmtp:106 maxplaybackrate=16000; sprop-maxcapturerate=16000; minptime=20; cbr=1; maxaveragebitrate=20000; useinbandfec=1
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")


    let oursdp = sdp.create( testsdp )

    let a = oursdp.getaudio()
    expect( a.port ).to.equal( 56858 )
    expect( a.address ).to.equal( "192.168.0.100" )

  } )

  it( `sdp webrtc parse`, async function() {

    const testsdp = `v=0
o=- 5012137047437522294 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS XjKU0noZQudw5wysGsQOsBwJVp0Dk9PbZxHw
m=audio 37867 UDP/TLS/RTP/SAVPF 111 63 103 104 9 0 8 106 105 13 110 112 113 126
c=IN IP4 82.19.206.102
a=rtcp:9 IN IP4 0.0.0.0
a=candidate:3011219415 1 udp 1686052607 82.19.206.102 37867 typ srflx raddr 192.168.0.141 rport 37867 generation 0 network-id 1 network-cost 10
a=ice-ufrag:7hP3
a=ice-pwd:N5djR9gk703hm3CBZ368MGZ0
a=ice-options:trickle
a=fingerprint:sha-256 D7:88:04:4B:B1:F2:B1:B3:ED:58:49:0C:31:5A:1D:E2:D3:1F:2D:43:FF:74:8E:9B:97:1F:E7:61:BE:27:62:3A
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=sendrecv
a=msid:XjKU0noZQudw5wysGsQOsBwJVp0Dk9PbZxHw 83ac3abd-cc86-427a-9cb7-ebac0c73964a
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:63 red/48000/2
a=fmtp:63 111/111
a=rtpmap:103 ISAC/16000
a=rtpmap:104 ISAC/32000
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:106 CN/32000
a=rtpmap:105 CN/16000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:112 telephone-event/32000
a=rtpmap:113 telephone-event/16000
a=rtpmap:126 telephone-event/8000
a=ssrc:2706351154 cname:aRo4fxWy9rdrJwUj
a=ssrc:2706351154 msid:XjKU0noZQudw5wysGsQOsBwJVp0Dk9PbZxHw 83ac3abd-cc86-427a-9cb7-ebac0c73964a
a=ssrc:2706351154 mslabel:XjKU0noZQudw5wysGsQOsBwJVp0Dk9PbZxHw
a=ssrc:2706351154 label:83ac3abd-cc86-427a-9cb7-ebac0c73964a`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    let oursdp = sdp.create( testsdp )

    expect( oursdp.sdp.media[ 0 ].fingerprint.hash )
      .to.equal( "D7:88:04:4B:B1:F2:B1:B3:ED:58:49:0C:31:5A:1D:E2:D3:1F:2D:43:FF:74:8E:9B:97:1F:E7:61:BE:27:62:3A" )
    expect( oursdp.sdp.media[ 0 ].fingerprint.type ).to.equal( "sha-256" )
    expect( oursdp.sdp.media[ 0 ].setup ).to.equal( "actpass" )

  } )

  it( `sdp webrtc generate`, async function() {
    
    let oursdp = sdp.create()
              .addcodecs( "pcma" )
              .setconnectionaddress( "127.0.0.1" )
              .setaudioport( 4 )
              .addssrc( 44 )
              .secure( "ourfingerprint", "act" )
              .addicecandidates( "127.0.0.1", 4 )
              .rtcpmux()
    
    expect( oursdp.sdp.media[ 0 ].rtcpMux ).to.equal( "rtcp-mux" )
    expect( oursdp.sdp.media[ 0 ].fingerprint.type ).to.equal( "sha-256" )
    expect( oursdp.sdp.media[ 0 ].fingerprint.hash ).to.equal( "ourfingerprint" )
    expect( oursdp.sdp.media[ 0 ].setup ).to.equal( "act" )
    expect( oursdp.sdp.media[ 0 ].candidates[ 0 ].foundation ).to.equal( 1 )
    expect( oursdp.sdp.media[ 0 ].candidates[ 0 ].component ).to.equal( 1 )
    expect( oursdp.sdp.media[ 0 ].candidates[ 0 ].transport ).to.equal( "udp" )
    expect( oursdp.sdp.media[ 0 ].candidates[ 0 ].priority ).to.equal( 255 )
    expect( oursdp.sdp.media[ 0 ].candidates[ 0 ].ip ).to.equal( "127.0.0.1" )
    expect( oursdp.sdp.media[ 0 ].candidates[ 0 ].port ).to.equal( 4 )
    expect( oursdp.sdp.media[ 0 ].candidates[ 0 ].type ).to.equal( "host" )
    expect( oursdp.sdp.media[ 0 ].candidates[ 0 ].generation ).to.equal( 0 )
  } )

  it( `sdp pcma real life sdp avon`, async function() {
  const testsdp = `v=0
o=MTLSBC 1657399906 1657399907 IN IP4 213.166.4.136
s=SIP Call
c=IN IP4 213.166.4.136
t=0 0
a=sendrecv
m=audio 48380 RTP/AVP 8
a=rtpmap:8 PCMA/8000`

    let oursdp = sdp.create( testsdp )
    let selectedcodec = oursdp.intersection( "g722 ilbc pcmu pcma", true )
    expect( selectedcodec ).to.equal( "pcma" )

  } )

  it( `sdp pcma real life sdp getautdio avon`, async function() {
    const testsdp = `v=0
o=MTLSBC 1657399906 1657399907 IN IP4 213.166.4.136
s=SIP Call
c=IN IP4 213.166.4.136
t=0 0
a=sendrecv
m=audio 48380 RTP/AVP 8
a=rtpmap:8 PCMA/8000`

    let oursdp = sdp.create( testsdp )
    let remoteaudio = oursdp.getaudio()

    let def = call._createchannelremotedef( remoteaudio.address, remoteaudio.port, remoteaudio.audio.payloads[ 0 ] )

    expect( def.remote.address ).to.equal( "213.166.4.136" )
    expect( def.remote.port ).to.equal( 48380 )
    expect( def.remote.codec ).to.equal( 8 )
  } )

  it( `another real life example`, async function() {
    const testsdp = `v=0
o=MTLSBC 1664810796 1664810796 IN IP4 213.166.4.133
s=SIP Call
c=IN IP4 213.166.4.133
t=0 0
m=audio 52290 RTP/AVP 8 101 13 0 3 18
a=rtpmap:8 PCMA/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:3 GSM/8000
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:13 CN/8000
a=ptime:20`

    let oursdp = sdp.create( testsdp )

    let selectedcodec = oursdp.intersection( "g722", true )
    console.log("selectedcodec",selectedcodec)
    return
    selectedcodec = oursdp.intersection( "g722", true )
    let remoteaudio = oursdp.getaudio()

    oursdp.select( selectedcodec )

    let ourlocalsdp = sdp.create()
                .addcodecs( selectedcodec )
                .addcodecs( "2833" )
                .setconnectionaddress( "1.1.1.1" )
                .setaudioport( 1000 )

    console.log(ourlocalsdp.toString())

  } )
} )
