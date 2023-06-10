
const expect = require( "chai" ).expect
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear
const callstore = require( "../../lib/store.js" )

/*
Similar to call.js but test late negotiation.

TODO:
1. check for different combinations of codec 
*/

describe( "uas.newuac - late", function() {

  afterEach( function() {
    clearcallmanager()
  } )

  beforeEach( function() {
    clearcallmanager()
  } )

  it( "uas.newuac - create late uac", async function() {

    const srfscenario = new srf.srfscenario()

    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 1,
      "storebyuuid": 1,
      "storebyentity": 0
    } )

    const child = await call.newuac( { "contact": "1000@dummy", "late": true } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 2,
      "storebyuuid": 2,
      "storebyentity": 0
    } )

    expect( child ).to.have.property( "uuid" ).that.is.a( "string" )
    expect( child ).to.have.property( "type" ).that.is.a( "string" ).to.equal( "uac" )
    expect( child ).to.have.property( "state" ).that.is.a( "object" )
    expect( child.state ).to.have.property( "trying" ).that.is.a( "boolean" ).to.be.true
    expect( child.state ).to.have.property( "ringing" ).that.is.a( "boolean" ).to.be.false
    expect( child.state ).to.have.property( "established" ).that.is.a( "boolean" ).to.be.true /* becuase we awaited the newuax */
    expect( child.state ).to.have.property( "canceled" ).that.is.a( "boolean" ).to.be.false
    expect( child.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.false

    expect( child ).to.have.property( "children" ) // Set - how do you test?
    expect( child ).to.have.property( "parent" ).that.is.a( "object" )

    expect( child ).to.have.property( "vars" ).that.is.a( "object" )

    expect( child ).to.have.property( "epochs" ).that.is.a( "object" )
    expect( child.epochs ).to.have.property( "startat" ).that.is.a( "number" )
    expect( child.epochs ).to.have.property( "answerat" ).that.is.a( "number" )
    expect( child.epochs ).to.have.property( "endat" ).that.is.a( "number" )

    expect( child ).to.have.property( "channels" ).that.is.a( "object" )
    expect( child.channels ).to.have.property( "audio" ).that.is.a( "object" )
    expect( child ).to.have.property( "sip" ).that.is.a( "object" )

    /* if uac */
    expect( child ).to.not.have.property( "source" ).that.is.a( "object" )

    await child.hangup()

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 1,
      "storebyuuid": 1,
      "storebyentity": 0
    } )

    await call.hangup()
    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

    expect( child.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.true

  } )

  it( "uas.newuac - create late uac parent already answered", async function() {
    const srfscenario = new srf.srfscenario()

    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 1,
      "storebyuuid": 1,
      "storebyentity": 0
    } )

    await call.answer()

    const child = await call.newuac( { "contact": "1000@dummy", "late": true } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 2,
      "storebyuuid": 2,
      "storebyentity": 0
    } )


    /* Hangup parent - child should follow */
    await call.hangup()

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

    expect( child.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.true

  } )
} )
