
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )
const projectrtp = require( "projectrtp" ).projectrtp

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear
const callstore = require( "../../lib/store.js" )

describe( "events", function() {

  it( `send fake events and wait`, async function() {
    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    await call.answer()

    setTimeout( () => {
      /* this is not part of our interface - do not call in the real world */
      call._tevent( "123*" )
    }, 10 )

    let events = await call.waitforevents()
    expect( events ).to.equal( "1" )

    events = await call.waitforevents( /[0-9][0-9]\*/ )
    expect( events ).to.equal( "23*" )

    call.hangup()

  } )

  it( `send fake events with clear`, async function() {
    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    await call.answer()

    setTimeout( () => {
      /* this is not part of our interface - do not call in the real world */
      call._tevent( "123*" )
    }, 10 )

    let events = await call.waitforevents()
    expect( events ).to.equal( "1" )

    call.clearevents()

    setTimeout( () => {
      /* this is not part of our interface - do not call in the real world */
      call._tevent( "45#33" )
    }, 10 )

    events = await call.waitforevents( /[0-9][0-9]\#/ )
    expect( events ).to.equal( "45#" )

    call.hangup()

  } )

  it( `timeout`, async function() {
    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    await call.answer()

    let events = await call.waitforevents( /[0-9A-D\*#]/, 10 )
    expect( events ).to.be.undefined

    call.hangup()

  } )
} )
