const expect = require( "chai" ).expect
const srf = require( "../mock/srf.js" )

/*
  RFC 3891 requires a Replaces header to carry a call-id, a to-tag and a
  from-tag. _runattendedxfer already means to reject anything else with a 400,
  but the guard reads .length off the match results before checking them for
  null - so a Replaces missing either tag throws a TypeError out of the guard
  that exists to catch it.

  The throw lands in the catch of dialog.on( "refer" ), which only traces, so no
  SIP response is sent at all: the transferring phone is left waiting on a REFER
  that is never answered while the transferee sits on hold.
*/
describe( "xfer - malformed replaces", function() {

  /**
   * @returns { Promise< object > } an inbound call, no media needed
   */
  const newcall = async () => {
    const srfscenario = new srf.srfscenario()
    return await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )
  }

  /**
   * @param { object } call
   * @param { string } replacesuri
   * @returns { Promise< Array > } the responses we sent
   */
  const referwith = async ( call, replacesuri ) => {
    const req = new srf.req( new srf.options() )
    const res = new srf.res()

    const sent = []
    res.onsend( ( code, msg ) => { sent.push( { code, msg } ) } )

    const replaces = replacesuri.match( /replaces=(.*?)(;|$)/i )
    await call._runattendedxfer( req, res, replaces, replacesuri )

    return sent
  }

  it( "replaces with no tags is rejected, not thrown on", async function() {

    const call = await newcall()
    const sent = await referwith( call, `sip:1000@dummy.com?Replaces=${call.sip.callid}` )

    expect( sent.length ).to.equal( 1 )
    expect( sent[ 0 ].code ).to.equal( 400 )

    await call.hangup()
  } )

  it( "replaces with only a to-tag is rejected, not thrown on", async function() {

    const call = await newcall()
    const sent = await referwith( call, `sip:1000@dummy.com?Replaces=${call.sip.callid};to-tag=abc` )

    expect( sent.length ).to.equal( 1 )
    expect( sent[ 0 ].code ).to.equal( 400 )

    await call.hangup()
  } )

  it( "replaces with only a from-tag is rejected, not thrown on", async function() {

    const call = await newcall()
    const sent = await referwith( call, `sip:1000@dummy.com?Replaces=${call.sip.callid};from-tag=def` )

    expect( sent.length ).to.equal( 1 )
    expect( sent[ 0 ].code ).to.equal( 400 )

    await call.hangup()
  } )
} )
