
const expect = require( "chai" ).expect
const srf = require( "../mock/srf.js" )

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear


describe( "call sdp generation", function() {
  it( "uas.newuac - check sdp", async function() {

    /* We are presented with sdp contained in the mock srf file */
    const srfscenario = new srf.srfscenario()

    const localsdp = []
    srfscenario.oncreateUAS( ( req, res, options ) => {
      localsdp.push( options.localSdp )
      return new srf.dialog()
    } )

    let callnumber = 0
    const callcount = 6
    const codecsselected = []
    await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => {
        await call.answer()

        codecsselected.push( call.sdp.remote.selected.name )
        callnumber++

        call.hangup()

        if( callcount == callnumber ) resolve()
      } )

      for( let i = 0; i < callcount; i++ ) {
        srfscenario.inbound()
      }
    } )

    expect( codecsselected[ 0 ] ).to.equal( "g722" )
    expect( codecsselected[ 1 ] ).to.equal( "pcma" )
    expect( codecsselected[ 2 ] ).to.equal( "pcmu" )
    expect( codecsselected[ 3 ] ).to.equal( "ilbc" )
    expect( codecsselected[ 4 ] ).to.equal( "g722" )
    expect( codecsselected[ 5 ] ).to.equal( "ilbc" )

    expect( localsdp[ 0 ] ).to.include( "RTP/AVP 9 101" ) /* g722 and dtmf */
    expect( localsdp[ 1 ] ).to.include( "RTP/AVP 8 101" ) /* pcma and dtmf */
    expect( localsdp[ 2 ] ).to.include( "RTP/AVP 0 101" ) /* pcmu and dtmf */
    expect( localsdp[ 3 ] ).to.include( "RTP/AVP 97 101" ) /* ilbc and dtmf */
    expect( localsdp[ 4 ] ).to.include( "RTP/AVP 9 101" ) /* g722 and dtmf */
    expect( localsdp[ 5 ] ).to.include( "RTP/AVP 97 101" ) /* ilbc and dtmf */
  } )

} )

describe( "call reinvite sdp", function() {

  afterEach( function() {
    clearcallmanager()
  } )

  const pcmaoffer = `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 8 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace( /(\r\n|\n|\r)/gm, "\r\n" )

  /**
   * The far end's answer to our re-INVITE, from a new port.
   * @param { string } pts the payload types in the m= line
   * @param { string } [ rtpmaps ] a= lines, each ending in a newline
   * @returns { string }
   */
  function answer( pts, rtpmaps = "" ) {
    return `v=0
o=- 1608235282228 1 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.142
t=0 0
m=audio 30000 RTP/AVP ${pts}
${rtpmaps}a=sendrecv`.replace( /(\r\n|\n|\r)/gm, "\r\n" )
  }

  /**
   * Answers an inbound pcma call, then re-INVITEs it with the far end
   * returning response (or throwing it, if it is an Error).
   * @param { object } response
   * @returns { Promise< { c: object, before: object } > } the call and its remote SDP before the re-INVITE
   */
  async function reinvitewith( response ) {
    const srfscenario = new srf.srfscenario()
    srfscenario.oncreateUAS( () => new srf.dialog() )

    const inboundreq = new srf.req( new srf.options() )
    inboundreq.msg.body = pcmaoffer

    return new Promise( ( resolve, reject ) => {
      srfscenario.oncall( async ( c ) => {
        try {
          await c.answer()
          const before = c.sdp.remote

          c._dialog.request = async () => {
            if( response instanceof Error ) throw response
            return response
          }
          await c.reinvite()

          resolve( { c, before } )
        } catch( e ) {
          reject( e )
        }
      } )

      srfscenario.inbound( inboundreq )
    } )
  }

  it( "keeps the codec in use when the answer still has it", async function() {
    const { c, before } = await reinvitewith( { msg: { status: 200, body: answer( "9 8 101", "a=rtpmap:101 telephone-event/8000\n" ) } } )

    expect( before.selected.name ).to.equal( "pcma" )
    expect( c.sdp.remote ).to.not.equal( before )
    expect( c.sdp.remote.getmedia().port ).to.equal( 30000 )
    /* g722 comes first in our codecs, but the channel is on pcma */
    expect( c.sdp.remote.selected.name ).to.equal( "pcma" )
    expect( c.sdp.remote.selected.pt ).to.equal( 8 )

    await c.hangup()
  } )

  it( "selects from our codecs when the answer drops the codec in use", async function() {
    /* G729 first, which we don't support */
    const { c } = await reinvitewith( { msg: { status: 200, body: answer( "18 9 101", "a=rtpmap:18 G729/8000\na=rtpmap:101 telephone-event/8000\n" ) } } )

    expect( c.sdp.remote.selected.name ).to.equal( "g722" )
    expect( c.sdp.remote.selected.pt ).to.equal( 9 )

    await c.hangup()
  } )

  it( "selects nothing when the answer has none of our codecs", async function() {
    const { c, before } = await reinvitewith( { msg: { status: 200, body: answer( "18", "a=rtpmap:18 G729/8000\n" ) } } )

    expect( c.sdp.remote ).to.not.equal( before )
    expect( c.sdp.remote.selected ).to.be.undefined

    await c.hangup()
  } )

  it( "leaves the remote sdp alone when the re-INVITE fails", async function() {
    /* a body on a failure is not an answer */
    const { c, before } = await reinvitewith( { msg: { status: 488, body: answer( "9" ) } } )

    expect( c.sdp.remote ).to.equal( before )
    expect( c.sdp.remote.selected.name ).to.equal( "pcma" )

    await c.hangup()
  } )

  it( "leaves the remote sdp alone when the re-INVITE request throws", async function() {
    const { c, before } = await reinvitewith( new Error( "no response" ) )

    expect( c.sdp.remote ).to.equal( before )
    expect( c.sdp.remote.selected.name ).to.equal( "pcma" )

    await c.hangup()
  } )

} )
