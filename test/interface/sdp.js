

const expect = require( "chai" ).expect
const sdp = require( "../../lib/sdp" )

const net = require( "net" )
const dns = require( "node:dns" )

describe( "sdp", function() {

  it( "create new sdp object", async function() {
    const s = sdp.create()

    /* check basic strcture */
    expect( s.sdp ).to.have.property( "version" ).that.is.a( "number" ).to.equal( 0 )
    expect( s.sdp ).to.have.property( "origin" ).that.is.a( "object" )
    expect( s.sdp ).to.have.property( "name" ).that.is.a( "string" ).to.equal( "project" )
    expect( s.sdp ).to.have.property( "timing" ).that.is.a( "object" )
    expect( s.sdp ).to.have.property( "connection" ).that.is.a( "object" )
    expect( s.sdp ).to.have.property( "media" ).that.is.a( "array" ).to.have.lengthOf( 1 )
  } )

  it( "pcma intersection 1", async function() {

    const testsdp = `v=0
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

  it( "pcma intersection 2", async function() {

    const testsdp = `v=0
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

  it( "generate sdp from object pcma", async function() {

    /* Setsession id only to permorm the test - normally use the default changing one */
    const newsdp = sdp.create().setsessionid( 0 ).addcodecs( "pcma" ).setconnectionaddress( "192.168.0.100" ).toString()

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

  it( "generate sdp from object ilbc pcma", async function() {
    const newsdp = sdp.create().setsessionid( 0 ).addcodecs( "ilbc pcma" ).toString()

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

  it( "don't duplicate codec request", async function() {

    const newsdp = sdp.create().setsessionid( 0 ).addcodecs( "ilbc ilbc pcma" ).toString()

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

  it( "exclude a ptime of 30", async function() {

    const testsdp = `v=0
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

  it( "looking for pcma", async function() {

    const testsdp = `v=0
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

  it( "looking for g722", async function() {

    const testsdp = `v=0
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

    const remote = sdp.create( testsdp )
    /* intersection with first only will call select */
    expect( remote.intersection( "g722 pcmu", true ) ).to.equal( "g722" )

    remote.setaudiodirection( "inactive" )
    expect( remote.toString() ).to.equal(
      "v=0\r\n" +
      "o=Z 1610744131900 1 IN IP4 127.0.0.1\r\n" +
      "s=Z\r\n" +
      "c=IN IP4 127.0.0.1\r\n" +
      "t=0 0\r\n" +
      "m=audio 56858 RTP/AVP 9 101\r\n" +
      "a=rtpmap:101 telephone-event/8000\r\n" +
      "a=fmtp:101 0-16\r\n" +
      "a=inactive\r\n"
    )
  } )

  it( "sdp member functions", async function() {
    const testsdp = `v=0
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


    const oursdp = sdp.create( testsdp )

    const a = oursdp.getaudio()
    expect( a.port ).to.equal( 56858 )
    expect( a.address ).to.equal( "192.168.0.100" )

  } )

  it( "sdp webrtc parse", async function() {

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

    const oursdp = sdp.create( testsdp )

    expect( oursdp.sdp.media[ 0 ].fingerprint.hash )
      .to.equal( "D7:88:04:4B:B1:F2:B1:B3:ED:58:49:0C:31:5A:1D:E2:D3:1F:2D:43:FF:74:8E:9B:97:1F:E7:61:BE:27:62:3A" )
    expect( oursdp.sdp.media[ 0 ].fingerprint.type ).to.equal( "sha-256" )
    expect( oursdp.sdp.media[ 0 ].setup ).to.equal( "actpass" )

  } )

  it( "sdp webrtc generate", async function() {
    
    const oursdp = sdp.create()
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

  it( "sdp pcma real life sdp avon", async function() {
    const testsdp = `v=0
o=MTLSBC 1657399906 1657399907 IN IP4 213.166.4.136
s=SIP Call
c=IN IP4 213.166.4.136
t=0 0
a=sendrecv
m=audio 48380 RTP/AVP 8
a=rtpmap:8 PCMA/8000`

    const oursdp = sdp.create( testsdp )
    const selectedcodec = oursdp.intersection( "g722 ilbc pcmu pcma", true )
    expect( selectedcodec ).to.equal( "pcma" )

  } )

  it( "sdp pcma real life sdp getautdio avon", async function() {
    const testsdp = `v=0
o=MTLSBC 1657399906 1657399907 IN IP4 213.166.4.136
s=SIP Call
c=IN IP4 213.166.4.136
t=0 0
a=sendrecv
m=audio 48380 RTP/AVP 8
a=rtpmap:8 PCMA/8000`

    const oursdp = sdp.create( testsdp )
    const remoteaudio = oursdp.getaudio()

    expect( remoteaudio.address ).to.equal( "213.166.4.136" )
    expect( remoteaudio.port ).to.equal( 48380 )
    expect( remoteaudio.audio.payloads[ 0 ] ).to.equal( 8 )
  } )

  it( "another real life example", async function() {
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

    const oursdp = sdp.create( testsdp )
    const selectedcodec = oursdp.intersection( "g722", true )

    /*
    selectedcodec = oursdp.intersection( "g722", true )
    let remoteaudio = oursdp.getaudio()

    oursdp.select( selectedcodec )

    let ourlocalsdp = sdp.create()
                .addcodecs( selectedcodec )
                .addcodecs( "2833" )
                .setconnectionaddress( "1.1.1.1" )
                .setaudioport( 1000 )

    console.log(ourlocalsdp.toString())
    */

    expect( selectedcodec ).to.be.false

  } )

  it( "outbound example - 2 legged", async () => {
    /*
      bv desktop invites external call.

      desktop                      bv                          magrathea
      INVITE (bvdeskinvitesdp) ---->
                                    INVITE (bvinvitesdp) ---------->
                                    <----------------------------100
                                    <----------183 (magrathea183sdp)
        <--- 183 (bvdeskinvite183sdp)
                                    <----------200 (magrathea200sdp)
        <--- 200 (bvdesktopinvite200sdp)
        BYE ------------------------>
        (488 not acceptable here)
    */

    const bvdeskinvitesdp = `v=0
o=- 2641339458124228143 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1
a=extmap-allow-mixed
a=msid-semantic: WMS eb9baf47-f163-4701-9a10-e388580c7de5
m=audio 54702 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126
c=IN IP4 82.19.206.102
a=rtcp:9 IN IP4 0.0.0.0
a=candidate:870150696 1 udp 1686052607 82.19.206.102 54702 typ srflx raddr 192.168.160.1 rport 54702 generation 0 network-id 1
a=ice-ufrag:qLvc
a=ice-pwd:gkGlGf07JxDRnLQFHIoQWvNZ
a=ice-options:trickle
a=fingerprint:sha-256 4C:16:43:4D:77:F5:02:B4:A8:2E:ED:71:AB:B5:0E:27:D5:58:B5:6A:B7:DA:11:6F:5B:35:63:5E:3E:C8:56:3C
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=sendrecv
a=msid:eb9baf47-f163-4701-9a10-e388580c7de5 53d56e97-1cd8-4f4c-b62a-c48fdc003b3d
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:63 red/48000/2
a=fmtp:63 111/111
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:126 telephone-event/8000
a=ssrc:168464047 cname:LxqEV0kknnvratqJ
a=ssrc:168464047 msid:eb9baf47-f163-4701-9a10-e388580c7de5 53d56e97-1cd8-4f4c-b62a-c48fdc003b3d
m=video 57333 UDP/TLS/RTP/SAVPF 96 97 102 103 104 105 106 107 108 109 127 125 39 40 45 46 98 99 100 101 112 113 114
c=IN IP4 192.168.160.1
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:qLvc
a=ice-pwd:gkGlGf07JxDRnLQFHIoQWvNZ
a=ice-options:trickle
a=fingerprint:sha-256 4C:16:43:4D:77:F5:02:B4:A8:2E:ED:71:AB:B5:0E:27:D5:58:B5:6A:B7:DA:11:6F:5B:35:63:5E:3E:C8:56:3C
a=setup:actpass
a=mid:1
a=extmap:14 urn:ietf:params:rtp-hdrext:toffset
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:13 urn:3gpp:video-orientation
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay
a=extmap:6 http://www.webrtc.org/experiments/rtp-hdrext/video-content-type
a=extmap:7 http://www.webrtc.org/experiments/rtp-hdrext/video-timing
a=extmap:8 http://www.webrtc.org/experiments/rtp-hdrext/color-space
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=extmap:10 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id
a=extmap:11 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id
a=sendrecv
a=msid:eb9baf47-f163-4701-9a10-e388580c7de5 dbdb36a1-7dbd-40b3-b870-1ac4cc089ee6
a=rtcp-mux
a=rtcp-rsize
a=rtpmap:96 VP8/90000
a=rtcp-fb:96 goog-remb
a=rtcp-fb:96 transport-cc
a=rtcp-fb:96 ccm fir
a=rtcp-fb:96 nack
a=rtcp-fb:96 nack pli
a=rtpmap:97 rtx/90000
a=fmtp:97 apt=96
a=rtpmap:102 H264/90000
a=rtcp-fb:102 goog-remb
a=rtcp-fb:102 transport-cc
a=rtcp-fb:102 ccm fir
a=rtcp-fb:102 nack
a=rtcp-fb:102 nack pli
a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f
a=rtpmap:103 rtx/90000
a=fmtp:103 apt=102
a=rtpmap:104 H264/90000
a=rtcp-fb:104 goog-remb
a=rtcp-fb:104 transport-cc
a=rtcp-fb:104 ccm fir
a=rtcp-fb:104 nack
a=rtcp-fb:104 nack pli
a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f
a=rtpmap:105 rtx/90000
a=fmtp:105 apt=104
a=rtpmap:106 H264/90000
a=rtcp-fb:106 goog-remb
a=rtcp-fb:106 transport-cc
a=rtcp-fb:106 ccm fir
a=rtcp-fb:106 nack
a=rtcp-fb:106 nack pli
a=fmtp:106 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=rtpmap:107 rtx/90000
a=fmtp:107 apt=106
a=rtpmap:108 H264/90000
a=rtcp-fb:108 goog-remb
a=rtcp-fb:108 transport-cc
a=rtcp-fb:108 ccm fir
a=rtcp-fb:108 nack
a=rtcp-fb:108 nack pli
a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f
a=rtpmap:109 rtx/90000
a=fmtp:109 apt=108
a=rtpmap:127 H264/90000
a=rtcp-fb:127 goog-remb
a=rtcp-fb:127 transport-cc
a=rtcp-fb:127 ccm fir
a=rtcp-fb:127 nack
a=rtcp-fb:127 nack pli
a=fmtp:127 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f
a=rtpmap:125 rtx/90000
a=fmtp:125 apt=127
a=rtpmap:39 H264/90000
a=rtcp-fb:39 goog-remb
a=rtcp-fb:39 transport-cc
a=rtcp-fb:39 ccm fir
a=rtcp-fb:39 nack
a=rtcp-fb:39 nack pli
a=fmtp:39 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=4d001f
a=rtpmap:40 rtx/90000
a=fmtp:40 apt=39
a=rtpmap:45 AV1/90000
a=rtcp-fb:45 goog-remb
a=rtcp-fb:45 transport-cc
a=rtcp-fb:45 ccm fir
a=rtcp-fb:45 nack
a=rtcp-fb:45 nack pli
a=rtpmap:46 rtx/90000
a=fmtp:46 apt=45
a=rtpmap:98 VP9/90000
a=rtcp-fb:98 goog-remb
a=rtcp-fb:98 transport-cc
a=rtcp-fb:98 ccm fir
a=rtcp-fb:98 nack
a=rtcp-fb:98 nack pli
a=fmtp:98 profile-id=0
a=rtpmap:99 rtx/90000
a=fmtp:99 apt=98
a=rtpmap:100 VP9/90000
a=rtcp-fb:100 goog-remb
a=rtcp-fb:100 transport-cc
a=rtcp-fb:100 ccm fir
a=rtcp-fb:100 nack
a=rtcp-fb:100 nack pli
a=fmtp:100 profile-id=2
a=rtpmap:101 rtx/90000
a=fmtp:101 apt=100
a=rtpmap:112 red/90000
a=rtpmap:113 rtx/90000
a=fmtp:113 apt=112
a=rtpmap:114 ulpfec/90000
a=ssrc-group:FID 3026998553 2660365910
a=ssrc:3026998553 cname:LxqEV0kknnvratqJ
a=ssrc:3026998553 msid:eb9baf47-f163-4701-9a10-e388580c7de5 dbdb36a1-7dbd-40b3-b870-1ac4cc089ee6
a=ssrc:2660365910 cname:LxqEV0kknnvratqJ
a=ssrc:2660365910 msid:eb9baf47-f163-4701-9a10-e388580c7de5 dbdb36a1-7dbd-40b3-b870-1ac4cc089ee6`

    const bvdeskinvite183sdp = `v=0
o=- 4317 0 IN IP4 127.0.0.1
s=project
c=IN IP4 13.42.100.66
t=0 0
a=msid-semantic: WMS 136f9ec7464dca67065c81da42013e84
m=audio 10036 UDP/TLS/RTP/SAVPF 9 101
a=rtpmap:9 G722/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=setup:passive
a=msid:136f9ec7464dca67065c81da42013e84 ff8ebd1be43cdf5170974bf0d1efb772
a=ptime:20
a=sendrecv
a=ice-ufrag:50cf0e6109bad2be
a=ice-pwd:9Tbl7U92hrzTUluayFbRPYh9
a=fingerprint:sha-256 12:31:FB:95:BB:00:1A:D8:24:94:71:21:CE:05:57:8F:47:1E:5E:C5:43:41:19:3F:2A:B8:8C:92:07:BB:BC:56
a=candidate:1 1 udp 255 13.42.100.66 10036 typ host generation 0
a=ssrc:3127369874 cname:97016b88e9a33a3b465b15cff21fec35
a=ssrc:3127369874 msid:136f9ec7464dca67065c81da42013e84 ff8ebd1be43cdf5170974bf0d1efb772
a=ssrc:3127369874 mslabel:136f9ec7464dca67065c81da42013e84
a=ssrc:3127369874 label:ff8ebd1be43cdf5170974bf0d1efb772
a=rtcp-mux`


    const bvinvitesdp = `v=0
o=- 4316 0 IN IP4 127.0.0.1
s=project
c=IN IP4 18.170.39.61
t=0 0
m=audio 10038 RTP/AVP 9 97 0 8
a=rtpmap:9 G722/8000
a=rtpmap:97 ilbc/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=fmtp:97 mode=20
a=ptime:20
a=sendrecv`

    const magrathea183sdp = `v=0
o=MTLSBC 1686295122 1686295122 IN IP4 213.166.4.135
s=SIP Call
c=IN IP4 213.166.4.135
t=0 0
a=sendrecv
m=audio 54330 RTP/AVP 8
a=rtpmap:8 PCMA/8000`

    const magrathea200sdp = `v=0
o=MTLSBC 1686295122 1686295123 IN IP4 213.166.4.135
s=SIP Call
c=IN IP4 213.166.4.135
t=0 0
a=sendrecv
m=audio 54330 RTP/AVP 8
a=rtpmap:8 PCMA/8000`

    const bvdesktopinvite200sdp = `v=0
o=- 4317 0 IN IP4 127.0.0.1
s=project
c=IN IP4 13.42.100.66
t=0 0
a=msid-semantic: WMS 136f9ec7464dca67065c81da42013e84
m=audio 10036 UDP/TLS/RTP/SAVPF 9 101
a=rtpmap:9 G722/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=setup:passive
a=msid:136f9ec7464dca67065c81da42013e84 ff8ebd1be43cdf5170974bf0d1efb772
a=ptime:20
a=sendrecv
a=ice-ufrag:50cf0e6109bad2be
a=ice-pwd:9Tbl7U92hrzTUluayFbRPYh9
a=fingerprint:sha-256 12:31:FB:95:BB:00:1A:D8:24:94:71:21:CE:05:57:8F:47:1E:5E:C5:43:41:19:3F:2A:B8:8C:92:07:BB:BC:56
a=candidate:1 1 udp 255 13.42.100.66 10036 typ host generation 0
a=ssrc:3127369874 cname:97016b88e9a33a3b465b15cff21fec35
a=ssrc:3127369874 msid:136f9ec7464dca67065c81da42013e84 ff8ebd1be43cdf5170974bf0d1efb772
a=ssrc:3127369874 mslabel:136f9ec7464dca67065c81da42013e84
a=ssrc:3127369874 label:ff8ebd1be43cdf5170974bf0d1efb772
a=rtcp-mux`


    const bvdeskinvitesdpobj = sdp.create( bvdeskinvitesdp )
    const bvdeskinvite183sdpobj = sdp.create( bvdeskinvite183sdp )
    const bvdesktopinvite200sdpobj = sdp.create( bvdesktopinvite200sdp )
    const bvinvitesdpobj = sdp.create( bvinvitesdp )
    const magrathea183sdpobj = sdp.create( magrathea183sdp )
    const magrathea200sdpobj = sdp.create( magrathea200sdp )

    const ourcodecs = "g722 ilbc pcmu pcma"
    expect( bvdeskinvite183sdpobj.intersection( ourcodecs ) ).to.equal( "g722" )
    expect( bvdeskinvitesdpobj.intersection( ourcodecs ) ).to.equal( "g722 pcmu pcma" )
    expect( bvinvitesdpobj.intersection( ourcodecs ) ).to.equal( "g722 ilbc pcmu pcma" )
    expect( magrathea183sdpobj.intersection( ourcodecs ) ).to.equal( "pcma" )

    expect( bvdesktopinvite200sdpobj.intersection( ourcodecs, true ) ).to.equal( "g722" )
    expect( magrathea200sdpobj.intersection( ourcodecs, true ) ).to.equal( "pcma" )
  } )

  it( "outbound example - inc ipv6", async () => {

    const sdpstr = `v=0
o=- 7873703533563891424 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS a46039f4-1857-410e-b1cc-215c09878068
m=audio 41645 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126
c=IN IP4 86.169.150.38
a=rtcp:9 IN IP4 0.0.0.0
a=candidate:532873972 1 udp 2122131711 2a00:23c6:e093:a801:6722:f7bb:aeeb:5e04 39087 typ host generation 0 network-id 4 network-cost 10
a=candidate:226183667 1 udp 1685987071 86.169.150.38 41645 typ srflx raddr 172.17.0.1 rport 41645 generation 0 network-id 2
a=ice-ufrag:c97P
a=ice-pwd:sK0NGVPIIx4/qEX+tCVW5dzH
a=ice-options:trickle
a=fingerprint:sha-256 0F:37:28:0F:66:1B:7E:D5:36:A4:EB:2D:D4:A8:6E:33:69:31:3B:D4:7B:71:0B:DE:41:09:D1:6C:1E:56:02:1C
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=sendrecv
a=msid:a46039f4-1857-410e-b1cc-215c09878068 ce8c9c25-2ea0-4079-aaa5-54f771d53310
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:63 red/48000/2
a=fmtp:63 111/111
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:126 telephone-event/8000
a=ssrc:222390620 cname:q7Is0hRbTrTbcMJM
a=ssrc:222390620 msid:a46039f4-1857-410e-b1cc-215c09878068 ce8c9c25-2ea0-4079-aaa5-54f771d53310
    `

    const sdpobj = sdp.create( sdpstr )
    const target = sdpobj.getaudio()

    expect( sdpobj.intersection( "g722", true ) ).to.equal( "g722" )

    /* our default is to ignore IPv6 addresses (until projectrtp supports it) */
    expect( target.port ).to.equal( 41645 )
    expect( target.address ).to.equal( "86.169.150.38" )

    
  } )

  it( "codec has", async () => {

    const sdpwith2833 = `v=0
o=- 4317 0 IN IP4 127.0.0.1
s=project
c=IN IP4 13.42.100.66
t=0 0
a=msid-semantic: WMS 136f9ec7464dca67065c81da42013e84
m=audio 10036 UDP/TLS/RTP/SAVPF 9 101
a=rtpmap:9 G722/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=setup:passive
a=msid:136f9ec7464dca67065c81da42013e84 ff8ebd1be43cdf5170974bf0d1efb772
a=ptime:20
a=sendrecv
a=ice-ufrag:50cf0e6109bad2be
a=ice-pwd:9Tbl7U92hrzTUluayFbRPYh9
a=fingerprint:sha-256 12:31:FB:95:BB:00:1A:D8:24:94:71:21:CE:05:57:8F:47:1E:5E:C5:43:41:19:3F:2A:B8:8C:92:07:BB:BC:56
a=candidate:1 1 udp 255 13.42.100.66 10036 typ host generation 0
a=ssrc:3127369874 cname:97016b88e9a33a3b465b15cff21fec35
a=ssrc:3127369874 msid:136f9ec7464dca67065c81da42013e84 ff8ebd1be43cdf5170974bf0d1efb772
a=ssrc:3127369874 mslabel:136f9ec7464dca67065c81da42013e84
a=ssrc:3127369874 label:ff8ebd1be43cdf5170974bf0d1efb772
a=rtcp-mux`

    const sdpwithout2833 = `v=0
o=- 4316 0 IN IP4 127.0.0.1
s=project
c=IN IP4 18.170.39.61
t=0 0
m=audio 10038 RTP/AVP 9 97 0 8
a=rtpmap:9 G722/8000
a=rtpmap:97 ilbc/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=fmtp:97 mode=20
a=ptime:20
a=sendrecv`

    const noilbc30 = `v=0
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
a=sendrecv`

    const sdpwith2833obj = sdp.create( sdpwith2833 )
    const sdpwithout2833obj = sdp.create( sdpwithout2833 )
    const noilbc30obj = sdp.create( noilbc30 )
    
    expect( sdpwith2833obj.has( "2833" ) ).to.be.true
    expect( sdpwith2833obj.has( "pcmu" ) ).to.be.false
    expect( sdpwith2833obj.has( "pcma" ) ).to.be.false


    expect( sdpwithout2833obj.has( "2833" ) ).to.be.false
    expect( sdpwithout2833obj.has( "g722" ) ).to.be.true
    expect( sdpwithout2833obj.has( "ilbc" ) ).to.be.true

    expect( noilbc30obj.has( "ilbc" ) ).to.be.false
    expect( noilbc30obj.has( "2833" ) ).to.be.true
    expect( noilbc30obj.has( "g722" ) ).to.be.true

  } )
  
  it( "Poly E350 dynamic pt", async () => {
    const ilbcpt = `v=0
o=- 1698686475 1698686475 IN IP4 82.19.206.102
s=Polycom IP Phone
c=IN IP4 82.19.206.102
t=0 0
a=sendrecv
m=audio 63000 RTP/AVP 110 115 99 9 102 0 8 18 127
a=rtpmap:110 iLBC/8000
a=fmtp:110 mode=20
a=rtpmap:115 G7221/32000
a=fmtp:115 bitrate=48000
a=rtpmap:99 SIREN14/16000
a=fmtp:99 bitrate=48000
a=rtpmap:9 G722/8000
a=rtpmap:102 G7221/16000
a=fmtp:102 bitrate=32000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=rtpmap:127 telephone-event/8000`

    const sdpilbc = sdp.create( ilbcpt )

    const expectdps = {
      ilbc: { payload: 110, codec: "iLBC", rate: 8000 },
      rfc2833: { payload: 127, codec: "telephone-event", rate: 8000 }
    }

    expect( sdpilbc.getdynamicpayloadtypes() ).to.deep.equal( expectdps )

    expect( sdpilbc.has( "ilbc" ) ).to.be.true
    expect( sdpilbc.has( "pcma" ) ).to.be.true
    expect( sdpilbc.has( "pcmu" ) ).to.be.true
    expect( sdpilbc.has( "g722" ) ).to.be.true

    const othersdp = sdp.create().addcodecs( "ilbc 2833" ).setdynamepayloadtypes( sdpilbc )

    expect( othersdp.toString() ).to.match( new RegExp( `v=0
o=- \\d+ 0 IN IP4 127.0.0.1
s=project
c=IN IP4 127.0.0.1
t=0 0
m=audio 0 RTP/AVP 110 127
a=rtpmap:110 ilbc/8000
a=rtpmap:127 telephone-event/8000
a=fmtp:110 mode=20
a=fmtp:127 0-16
a=ptime:20
a=sendrecv
`.replace( /\r\n/g, "\n" ).replace( /\n/g, "\r\n" ) ) )

    sdpilbc.select( "pcma" )

    const audio = sdpilbc.getaudio()

    expect( audio.port ).to.equal( 63000 )
    expect( audio.address ).to.equal( "82.19.206.102" )
    expect( audio.audio.payloads[ 0 ] ).to.equal( 8 )

    expect( sdpilbc.selected ).to.deep.equal( { name: "pcma", pt: 8, dpt: 8 } )
    sdpilbc.select( "ilbc" )
    expect( sdpilbc.selected ).to.deep.equal( { name: "ilbc", pt: 97, dpt: 110 } )

  } )

  it( "Poly E220 hold", async () => {

    const polysdp = `v=0
o=- 1699364340 1699364341 IN IP4 82.19.206.102
s=Polycom IP Phone
c=IN IP4 82.19.206.102
t=0 0
a=sendonly
m=audio 63558 RTP/AVP 9 127
a=rtpmap:9 G722/8000
a=rtpmap:127 telephone-event/8000
a=sendonly
`.replace( /\r\n/g, "\n" ).replace( /\n/g, "\r\n" )

    const sdpobj = sdp.create( polysdp )

    /* ref call.#getsdpformodify */
    const media = sdpobj.getmedia()

    let ip
    if( sdpobj && sdpobj.sdp && sdpobj.sdp.connection && sdpobj.sdp.connection.ip ) {
      ip = sdpobj.sdp.connection.ip
    }

    expect( ip ).to.equal( "82.19.206.102" )
    expect( media.direction ).to.equal( "sendonly" )
    
  } )

  it( "Poly E220 unhold", async () => {

    const polysdp = `v=0
o=- 1699364340 1699364342 IN IP4 82.19.206.102
s=Polycom IP Phone
c=IN IP4 82.19.206.102
t=0 0
a=sendrecv
m=audio 63558 RTP/AVP 110 9 0 8 127
a=rtpmap:110 iLBC/8000
a=fmtp:110 mode=20
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:127 telephone-event/8000
`.replace( /\r\n/g, "\n" ).replace( /\n/g, "\r\n" )

    const sdpobj = sdp.create( polysdp )

    /* ref call.#getsdpformodify */
    const media = sdpobj.getmedia()

    let ip
    if( sdpobj && sdpobj.sdp && sdpobj.sdp.connection && sdpobj.sdp.connection.ip ) {
      ip = sdpobj.sdp.connection.ip
    }

    expect( ip ).to.equal( "82.19.206.102" )
    /* somewhere in the library - default is sendrecv so it is left undefined */
    expect( media.direction ).to.be.undefined
  } )

  it( "receive sdp send sdp ilbc", async () => {
    const polysdp = `v=0
o=- 1699618792 1699618792 IN IP4 82.19.206.102
s=Polycom IP Phone
c=IN IP4 82.19.206.102
t=0 0
a=sendrecv
m=audio 63450 RTP/AVP 110 127
a=rtpmap:110 iLBC/8000
a=fmtp:110 mode=20
a=rtpmap:127 telephone-event/8000
`.replace( /\r\n/g, "\n" ).replace( /\n/g, "\r\n" )

    const sdpobj = sdp.create( polysdp )

    sdpobj.select( sdpobj.intersection( "g722 pcma pcmu ilbc", true ) )

    const respsdp = sdp.create()
      .addcodecs( sdpobj.selected.name )
      .setconnectionaddress( "1.1.1.1" )
      .setaudioport( 10000 )
      .setdynamepayloadtypes( sdpobj )

    const outsdpstring = respsdp.toString()

    expect( outsdpstring ).include( outsdpstring, "m=audio 10000 RTP/AVP 110" )
    expect( outsdpstring ).include( outsdpstring, "a=rtpmap:110 ilbc/8000" )

  } )

  it( "SDP IP V6 candidate", async () => {
    const wsssdp = `v=0
o=- 4684977919666729506 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS 2e008e23-265a-42a0-ba6f-d147a9d0ca42
m=audio 28022 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126
c=IN IP4 209.35.84.57
a=rtcp:9 IN IP4 0.0.0.0
a=candidate:1446275835 1 udp 2122129151 192.168.1.108 52396 typ host generation 0 network-id 1
a=candidate:1833640547 1 udp 2122063615 172.25.160.1 52397 typ host generation 0 network-id 4
a=candidate:3642338680 1 udp 2122262783 2a01:4b00:ea24:b300:10a8:8a7e:234c:3161 52398 typ host generation 0 network-id 2
a=candidate:4227024272 1 udp 2122197247 2a01:4b00:ea24:b300:f50b:e799:7a1:8cc3 52399 typ host generation 0 network-id 3
a=candidate:2218323828 1 udp 1685921535 209.35.84.57 28022 typ srflx raddr 192.168.1.108 rport 52396 generation 0 network-id 1
a=ice-ufrag:5emx
a=ice-pwd:T78uDKroul30L+4WytFCzZiv
a=ice-options:trickle
a=fingerprint:sha-256 AE:24:0F:8F:23:5C:EE:D5:F8:BD:EB:2C:86:15:13:44:A2:D1:30:9E:74:68:87:8C:50:80:F7:9A:6A:D9:3A:56
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=sendrecv
a=msid:2e008e23-265a-42a0-ba6f-d147a9d0ca42 ff52617f-a48b-454e-9d50-47367329f318
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:63 red/48000/2
a=fmtp:63 111/111
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:126 telephone-event/8000
a=ssrc:2953770750 cname:/DZABa/Op+oV703F
a=ssrc:2953770750 msid:2e008e23-265a-42a0-ba6f-d147a9d0ca42 ff52617f-a48b-454e-9d50-47367329f318
`.replace( /\r\n/g, "\n" ).replace( /\n/g, "\r\n" )

    const sdpobj = sdp.create( wsssdp )
    const target = sdpobj.getaudio()
    const ignoreipv6candidates = true

    let candidates = sdpobj.sdp.media[ 0 ].candidates
    if( 0 < candidates.length ) {
      if( ignoreipv6candidates ) {
        candidates = candidates.filter( ( c ) => { 
          const ismatch = net.isIPv6( c.ip )
          return !ismatch
        } )
      }

      candidates.sort( ( l, r ) => { return r.priority - l.priority } )
      target.port = candidates[ 0 ].port

      await new Promise( ( resolve ) => {
        dns.lookup( candidates[ 0 ].ip, ( err, result ) => {
          if( !err ) target.address = result
          resolve()
        } )
      } )

      expect( target.address ).to.equal( "192.168.1.108" )
      expect( target.port ).to.equal( 52396 )
    }
  } )

  it( "SDP IP V6 and local hashed candidates", async () => {
    const wsssdp = `v=0
o=- 5035661740065349798 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS 283cd9e0-ac17-4a6b-b5bc-60fceb19b94f
m=audio 61955 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126
c=IN IP4 90.202.48.79
a=rtcp:9 IN IP4 0.0.0.0
a=candidate:3845972840 1 udp 2121998079 192.168.0.19 61955 typ host generation 0 network-id 1
a=candidate:1805236522 1 udp 2122265343 fd8e:59dd:8c2d::e25d:b2e0:9a36:9e91 61956 typ host generation 0 network-id 4
a=candidate:32897429 1 udp 2122199807 fd8e:59dd:8c2d::1856:4c0d:8f7a:e8a4 61957 typ host generation 0 network-id 5
a=candidate:144781267 1 udp 2122131711 2a02:c7c:3950:800:1856:4c0d:8f7a:e8a4 61958 typ host generation 0 network-id 2
a=candidate:3569255005 1 udp 2122066175 2a02:c7c:3950:800:2e9:656d:c9ee:8cbc 61959 typ host generation 0 network-id 3
a=candidate:1044366121 1 udp 1685790463 90.202.48.79 61955 typ srflx raddr 192.168.0.19 rport 61955 generation 0 network-id 1
a=ice-ufrag:x8jh
a=ice-pwd:dbn/yuXRtq7VsjQ+mzXtAy/A
a=ice-options:trickle
a=fingerprint:sha-256 F9:F0:29:1F:23:D4:8E:8A:25:78:E7:97:D2:EE:56:BC:B6:26:C9:9E:30:B0:14:A5:B4:32:97:31:88:16:6D:FF
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=sendrecv
a=msid:283cd9e0-ac17-4a6b-b5bc-60fceb19b94f a3f88fda-444b-4d7b-b55a-982f5bb7180e
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:63 red/48000/2
a=fmtp:63 111/111
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:126 telephone-event/8000
a=ssrc:874678690 cname:9XGi4p1yKdReFiKK
a=ssrc:874678690 msid:283cd9e0-ac17-4a6b-b5bc-60fceb19b94f a3f88fda-444b-4d7b-b55a-982f5bb7180e
`.replace( /\r\n/g, "\n" ).replace( /\n/g, "\r\n" )

    const sdpobj = sdp.create( wsssdp )
    const target = sdpobj.getaudio()
    const ignoreipv6candidates = true

    let candidates = sdpobj.sdp.media[ 0 ].candidates
    if( 0 < candidates.length ) {
      if( ignoreipv6candidates ) {
        candidates = candidates.filter( ( c ) => { 
          const ismatch = net.isIPv6( c.ip )
          return !ismatch
        } )
      }

      candidates.sort( ( l, r ) => { return r.priority - l.priority } )
      target.port = candidates[ 0 ].port

      await new Promise( ( resolve ) => {
        dns.lookup( candidates[ 0 ].ip, ( err, result ) => {
          if( !err ) target.address = result
          resolve()
        } )
      } )

      /* Ideally we use the 190 address but the candidates reported this one as higher priority */
      expect( target.address ).to.equal( "192.168.0.19" )
      expect( target.port ).to.equal( 61955 )
    }
  } )

  it( "select codecs and regenerate sdp 1", async () => {
    const testsdp = `v=0
o=Z 1608236465345 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 56802 RTP/AVP 8 0 9 97 106 98
a=rtpmap:97 iLBC/8000
a=fmtp:97 mode=20
a=rtpmap:106 opus/48000/2
a=fmtp:106 minptime=20; cbr=1; maxaveragebitrate=40000; useinbandfec=1
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    const sdpobj = sdp.create( testsdp )
    sdpobj.select( "ilbc" )
    const oursdpstr = sdpobj.toString()

    expect( oursdpstr ).to.include( "RTP/AVP 97 101\r\n" )
  } )

  it( "select codecs and regenerate sdp 2", async () => {
    const testsdp = `v=0
o=Z 1608236465345 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 56802 RTP/AVP 8 0 9 97 106 101
a=rtpmap:97 iLBC/8000
a=fmtp:97 mode=20
a=rtpmap:106 opus/48000/2
a=fmtp:106 minptime=20; cbr=1; maxaveragebitrate=40000; useinbandfec=1
a=rtpmap:101 telephone-event/48000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    const sdpobj = sdp.create( testsdp )
    sdpobj.select( "ilbc" )
    const oursdpstr = sdpobj.toString()

    expect( oursdpstr ).to.include( "RTP/AVP 97 101\r\n" )
  } )

  it( "select codecs and regenerate sdp 3", async () => {
    const testsdp = `v=0
o=Z 1608236465345 1 IN IP4 192.168.0.141
s=Z
c=IN IP4 192.168.0.141
t=0 0
m=audio 56802 RTP/AVP 8 0 9 97 106
a=rtpmap:97 iLBC/8000
a=fmtp:97 mode=20
a=rtpmap:106 opus/48000/2
a=fmtp:106 minptime=20; cbr=1; maxaveragebitrate=40000; useinbandfec=1
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

    const sdpobj = sdp.create( testsdp )
    sdpobj.select( "ilbc" )
    const oursdpstr = sdpobj.toString()

    expect( oursdpstr ).to.include( "RTP/AVP 97 101\r\n" )
  } )
} )
