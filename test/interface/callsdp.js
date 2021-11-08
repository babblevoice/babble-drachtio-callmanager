
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )
const projectrtp = require( "projectrtp" ).projectrtp

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear

describe( "call sdp generation", function() {
  it( `uas.newuac - check sdp`, async function() {

    /* We are presented with sdp contained in the mock srf file */
    let srfscenario = new srf.srfscenario()

    let localsdp = []
    srfscenario.oncreateUAS( ( req, res, options ) => {
      localsdp.push( options.localSdp )
      return new srf.dialog()
    } )

    let callnumber = 0
    let callcount = 6
    let codecsselected = []
    let c = await new Promise( ( done ) => {
      srfscenario.oncall( async ( call ) => {
        await call.answer()

        codecsselected.push( call.selectedcodec )
        callnumber++

        call.hangup()

        if( callcount == callnumber ) done()
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
