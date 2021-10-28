

const expect = require( "chai" ).expect
const sdp = require( "../../lib/sdp.js" )

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
} )
