
const expect = require( "chai" ).expect
const srf = require( "../mock/srf.js" )


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
