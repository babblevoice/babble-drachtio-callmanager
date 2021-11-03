
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )
const projectrtp = require( "projectrtp" ).projectrtp

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear
const callstore = require( "../../lib/store.js" )

after( async () => {
  await projectrtp.shutdown()
} )

before( async () => {
  await projectrtp.run()
} )

/* All call objects should be created by the framework - but we create them to test */

describe( "call object", function() {

  beforeEach( function() {
    clearcallmanager()
  } )

  it( `uas.newuac - create uas`, async function() {

    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

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

    expect( call ).to.have.property( "uuid" ).that.is.a( "string" )
    expect( call ).to.have.property( "type" ).that.is.a( "string" ).to.equal( "uas" )
    expect( call ).to.have.property( "state" ).that.is.a( "object" )
    expect( call.state ).to.have.property( "trying" ).that.is.a( "boolean" ).to.be.false
    expect( call.state ).to.have.property( "ringing" ).that.is.a( "boolean" ).to.be.false
    expect( call.state ).to.have.property( "established" ).that.is.a( "boolean" ).to.be.false
    expect( call.state ).to.have.property( "canceled" ).that.is.a( "boolean" ).to.be.false
    expect( call.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.true

    expect( call ).to.have.property( "children" ) // Set - how do you test?
    expect( call ).to.have.property( "parent" ).that.is.a( "boolean" ).to.be.false

    expect( call ).to.have.property( "vars" ).that.is.a( "object" )

    expect( call ).to.have.property( "epochs" ).that.is.a( "object" )
    expect( call.epochs ).to.have.property( "startat" ).that.is.a( "number" )
    expect( call.epochs ).to.have.property( "answerat" ).that.is.a( "number" )
    expect( call.epochs ).to.have.property( "endat" ).that.is.a( "number" )

    expect( call ).to.have.property( "channels" ).that.is.a( "object" )
    expect( call.channels ).to.have.property( "audio" ).to.be.false

    /* if uas */
    expect( call ).to.have.property( "source" ).that.is.a( "object" )
    expect( call.source ).to.have.property( "address" ).that.is.a( "string" )
    expect( call.source ).to.have.property( "port" ).that.is.a( "number" )
    expect( call.source ).to.have.property( "protocol" ).that.is.a( "string" )
    expect( call ).to.have.property( "sip" ).that.is.a( "object" )
    expect( call.sip ).to.have.property( "callid" ).that.is.a( "string" )
    expect( call.sip ).to.have.property( "tags" ).that.is.a( "object" )
    expect( call.sip.tags ).to.have.property( "remote" ).that.is.a( "string" )
    expect( call.sip.tags ).to.have.property( "local" ).that.is.a( "string" )

    expect( call.hangup_cause.reason ).to.equal( "NORMAL_CLEARING" )
    expect( call.hangup_cause.sip ).to.equal( 487 )

  } )

  it( `uas.newuac - create uac`, async function() {

    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 1,
      "storebyuuid": 1,
      "storebyentity": 0
    } )

    let child = await call.newuac( "1000@dummy" )

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
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

    expect( child.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.true

  } )


  it( `uas.newuac detatch from parent`, async function() {

    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 1,
      "storebyuuid": 1,
      "storebyentity": 0
    } )

    let child = await call.newuac( "1000@dummy" )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 2,
      "storebyuuid": 2,
      "storebyentity": 0
    } )

    child.detach()
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
  } )

  it( `uas.newuac - 486`, async function() {

    let srfscenario = new srf.srfscenario()
    srfscenario.oncreateUAC( () => {
      throw { "status": 486 }
    } )

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let child = await call.newuac( "1000@dummy" )

    expect( child.hangup_cause.sip ).equal( 486 )
    expect( child.hangup_cause.reason ).equal( "USER_BUSY" )

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
  } )


  it( `uas.newuac - timeout`, async function() {

    let srfscenario = new srf.srfscenario()
    srfscenario.options.srf.newuactimeout = 20 /* longer than our uactimeout */

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let child = await call.newuac( "1000@dummy", { "uactimeout": 10 } ) /* overide default - very short */

    expect( child.destroyed ).to.be.true
    await child.waitforhangup()

    expect( child.hangup_cause.sip ).equal( 408 )
    expect( child.hangup_cause.reason ).equal( "REQUEST_TIMEOUT" )
    expect( child.hangup_cause.src ).equal( "us" )

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
  } )

  it( `uas.newuac - child remote hangup`, async function() {

    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 1,
      "storebyuuid": 1,
      "storebyentity": 0
    } )

    let child = await call.newuac( "1000@dummy" )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 2,
      "storebyuuid": 2,
      "storebyentity": 0
    } )

    expect( child.established ).to.be.true

    /* mock destroy from network */
    child._dialog.destroy()

    await child.waitforhangup()

    expect( child.hangup_cause.sip ).equal( 487 )
    expect( child.hangup_cause.reason ).equal( "NORMAL_CLEARING" )
    expect( child.hangup_cause.src ).equal( "wire" )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

    expect( child.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.true

  } )

  it( `uas.newuac - new call event`, async function() {

    let srfscenario = new srf.srfscenario()

    let eventhappened = false
    srfscenario.options.em.on( "call.new", ( c ) => {
      expect( c ).to.be.an.instanceof( call.call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true
    } )

    await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    expect( eventhappened ).to.be.true

  } )

  it( `uas.newuac - ringing event`, async function() {

    let srfscenario = new srf.srfscenario()

    let eventhappened = false
    srfscenario.options.em.on( "call.ringing", ( c ) => {
      expect( c ).to.be.an.instanceof( call.call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true

    } )

    let c = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    /* signal ringing (this would normally come from the other side) */
    c.ring()

    expect( eventhappened ).to.be.true

  } )

  it( `uas.newuac - answered and destroyed event`, async function() {

    let srfscenario = new srf.srfscenario()

    let eventhappened = false
    srfscenario.options.em.on( "call.answered", ( c ) => {
      expect( c ).to.be.an.instanceof( call.call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true
    } )

    srfscenario.options.em.on( "call.destroyed", ( c ) => {
      eventhappened = false
    } )

    let c = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    /* signal answered (this could be called for a ivr or a bridged call) */
    await c.answer()

    expect( eventhappened ).to.be.true

    await c.hangup()

    expect( eventhappened ).to.be.false
  } )
} )
