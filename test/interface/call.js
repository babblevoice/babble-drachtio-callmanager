
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

  afterEach( function() {
    clearcallmanager()
  } )

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

    let child = await call.newuac( { "contact": "1000@dummy" } )

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

  it( `uas.newuac - create uac by entity no registrar`, async function() {
    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let child = await call.newuac( { "entity": { "uri": "1000@dummy" } } )
    expect( child ).to.be.false

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 1,
      "storebyuuid": 1,
      "storebyentity": 0
    } )

    await call.hangup()
  } )

  it( `uas.newuac - create uac by entity with registrar`, async function() {

    let options = {
      "registrar": {
        "contacts": async ( entity ) => {
          return {
            "username": "1000",
            "realm": "dummy.com",
            "display": "Bob",
            "uri": "1000@dummy.com",
            "contacts": [ "sip:1000@dummy.com:5060", "sip:1000@dummy.com:5060;transport=blah" ]
          }
        }
      }
    }

    let srfscenario = new srf.srfscenario( options )

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let child = await call.newuac( { "entity": { "uri": "1000@dummy" } } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 2,
      "storebyuuid": 2,
      "storebyentity": 1
    } )

    let e = await child.entity
    expect( e.ccc ).to.equal( 1 )

    /* mock */
    let requestoptions = false

    child._req.set( "ALLOW", "INVITE, UPDATE, OPTIONS" )
    child._dialog.on( "request", ( options ) => requestoptions = options )

    child.update()

    expect( requestoptions.method ).to.equal( "update" )
    expect( requestoptions.headers[ "P-Preferred-Identity" ] ).to.equal( `"" <sip:1000@dummy.com>` )

    await call.hangup()

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

    expect( srfscenario.options.srf._createuaccount ).to.equal( 2 )

  } )

  it( `uas.newuac - create uac by entity with max limit and registrar`, async function() {

    let options = {
      "registrar": {
        "contacts": async ( entity ) => {
          return {
            "username": "1000",
            "realm": "dummy.com",
            "display": "Bob",
            "uri": "1000@dummy.com",
            "contacts": [ "sip:1000@dummy.com:5060", "sip:1000@dummy.com:5060;transport=blah" ]
          }
        }
      }
    }

    let srfscenario = new srf.srfscenario( options )

    let inboundcall = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let child = await inboundcall.newuac( { "entity": { "uri": "1000@dummy", "max": 1 } } )
    let child2 = await call.newuac( { "entity": { "uri": "1000@dummy", "max": 1 } } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 2,
      "storebyuuid": 2,
      "storebyentity": 1
    } )

    let child3 = await call.newuac( { "entity": { "uri": "1000@dummy" } } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 3,
      "storebyuuid": 3,
      "storebyentity": 1
    } )

    await child3.hangup()
    await inboundcall.hangup()

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

    expect( srfscenario.options.srf._createuaccount ).to.equal( 4 )
    expect( child2 ).to.be.false

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

    let child = await call.newuac( { "contact": "1000@dummy" } )

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

    let children = [] 
    let child = await call.newuac( { "contact": "1000@dummy" }, { "early": ( c ) => {
        children.push( c )
      }
    } )

    expect( children.length ).to.equal( 1 )
    expect( children[ 0 ].hangup_cause.sip ).equal( 486 )
    expect( children[ 0 ].hangup_cause.reason ).equal( "USER_BUSY" )

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

    let children = [] 
    let child = await call.newuac( { "contact": "1000@dummy", "uactimeout": 10 }, { "early": ( c ) => {
        children.push( c )
      }
    } ) /* overide default - very short */

    expect( child ).to.be.false
    expect( children.length ).to.equal( 1 )
    expect( children[ 0 ].destroyed ).to.be.true

    expect( children[ 0 ].hangup_cause.sip ).equal( 408 )
    expect( children[ 0 ].hangup_cause.reason ).equal( "REQUEST_TIMEOUT" )
    expect( children[ 0 ].hangup_cause.src ).equal( "us" )

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

    let child = await call.newuac( { "contact": "1000@dummy" } )

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
      expect( c ).to.be.an.instanceof( call )
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
      expect( c ).to.be.an.instanceof( call )
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

  it( `uas.newuac - destroyed event`, async function() {

    let srfscenario = new srf.srfscenario()

    let waitforcallresolve
    let waitforcall = new Promise( ( resolve ) => waitforcallresolve = resolve )

    let ourcall
    call.newuac( { "contact": "1000@dummy.com" }, { "early": ( c ) => { ourcall = c; waitforcallresolve(); } } )

    await waitforcall

    let eventhappened = false
    ourcall.on( "call.destroyed", ( c ) => {
      eventhappened = true
    } )

    /* immediatly hangup */
    await ourcall.hangup()

    expect( eventhappened ).to.be.true
  } )

  it( `uas.newuac - answered and destroyed event`, async function() {

    let srfscenario = new srf.srfscenario()

    let eventhappened = false
    srfscenario.options.em.on( "call.answered", ( c ) => {
      expect( c ).to.be.an.instanceof( call )
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

  it( `uas.newuac - authed event`, async function() {

    let options = {
      "userlookup": async ( username, realm ) => {
        return {
          "secret": "zanzibar",
          "username": username,
          "realm": realm
        }
      }
    }

    let srfscenario = new srf.srfscenario( options )

    let eventhappened = false
    srfscenario.options.em.on( "call.authed", ( c ) => {
      expect( c ).to.be.an.instanceof( call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true
    } )

    let c = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => {
        resolve( call )
      } )
      srfscenario.inbound()
    } )

    let onsendcount = 0
    /* mock -
    auth example from https://datatracker.ietf.org/doc/html/draft-smith-sipping-auth-examples-01 3.3*/
    c._req.msg.uri = "sip:bob@biloxi.com"
    c._req.setparsedheader( "from", { "params": { "tag": "767sf76wew" }, "uri": "sip:bob@biloxi.com", "host": "biloxi.com" } )
    c._auth._nonce = "dcd98b7102dd2f0e8b11d0f600bfb0c093"
    c._auth._opaque = "5ccc069c403ebaf9f0171e9517f40e41"

    c._res.onsend( ( code, msg ) => {

      if( 0 == onsendcount ) {
        let request = msg.headers[ "Proxy-Authenticate" ]

        /* The items a uac will add */
        request += `, username="bob", nc=00000001,cnonce="0a4f113b",`
        request += ` uri="sip:bob@biloxi.com",`
        request += ` response="89eb0059246c02b2f6ee02c7961d5ea3"`

        srfscenario.req.set( "Proxy-Authorization", request )


        c._onauth( srfscenario.req, srfscenario.res )

      }

      onsendcount++
    } )

    /* signal answered (this could be called for a ivr or a bridged call) */
    await c.auth()
    await c.hangup()

    expect( eventhappened ).to.be.true
    expect( c.hangup_cause.reason ).to.equal( "NORMAL_CLEARING" )
    expect( c.hangup_cause.src ).to.equal( "us" )
    expect( c.state.destroyed ).to.equal( true )
    expect( c.state.authed ).to.equal( true )
    let e = await c.entity
    expect( e.username ).to.equal( "bob" )
    expect( e.realm ).to.equal( "biloxi.com" )
    expect( e.uri ).to.equal( "bob@biloxi.com" )

  } )

  it( `uas.newuac - auth failed`, async function() {

    let options = {
      "userlookup": async ( username, realm ) => {
        return {
          "secret": "zanzibar",
          "username": username,
          "realm": realm
        }
      }
    }

    let srfscenario = new srf.srfscenario( options )

    let eventhappened = false
    srfscenario.options.em.on( "call.authed.failed", ( c ) => {
      expect( c ).to.be.an.instanceof( call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true
    } )

    let c = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => {

        let onsendcount = 0
        /* mock -
        auth example from https://datatracker.ietf.org/doc/html/draft-smith-sipping-auth-examples-01 3.3*/
        call._req.msg.uri = "sip:bob@biloxi.com"
        call._req.setparsedheader( "from", { "params": { "tag": "767sf76wew" }, "uri": "sip:bob@biloxi.com", "host": "biloxi.com" } )
        call._auth._nonce = "dcd98b7102dd2f0e8b11d0f600bfb0c093"
        call._auth._opaque = "5ccc069c403ebaf9f0171e9517f40e41"

        call._res.onsend( ( code, msg ) => {

          if( 0 == onsendcount ) {
            let request = msg.headers[ "Proxy-Authenticate" ]

            /* The items a uac will add */
            request += `, username="bob", nc=00000001,cnonce="0a4f113b",`
            request += ` uri="sip:bob@biloxi.com",`
            request += ` response="89eb0059246c02b2f6ee02c7961d5ea"`

            srfscenario.req.set( "Proxy-Authorization", request )


            call._onauth( srfscenario.req, srfscenario.res )

          } else if( 1 == onsendcount ) {
            resolve( call )
          }

          onsendcount++
        } )

        /* signal answered (this could be called for a ivr or a bridged call) */
        await call.auth()
      } )
      srfscenario.inbound()
    } )

    expect( eventhappened ).to.be.true
    expect( c.hangup_cause.reason ).to.equal( "FORBIDDEN" )
    expect( c.hangup_cause.src ).to.equal( "us" )
    expect( c.state.destroyed ).to.equal( true )
    expect( c.state.authed ).to.equal( false )
  } )

  it( `uas.newuac - caller id set correctly`, async function() {

    let srfscenario = new srf.srfscenario( {} )

    let createuacoptions
    srfscenario.oncreateUAC( ( contact, options, callbacks ) => {
      createuacoptions = options

    } )

    let options = {
      "contact": "ourcontactstring",
      "late": true
    }

    await call.newuac( options, { "early": ( c ) => c.hangup() } )

    expect( createuacoptions.headers[ "P-Preferred-Identity" ] ).to.equal( `"" <sip:0000000000@localhost.localdomain>` )
    expect( createuacoptions.noAck ).to.be.true
  } )

  it( `uas.newuac - early callback is called`, async function() {
    let srfscenario = new srf.srfscenario( {} )

    let options = {
      "contact": "ourcontactstring",
      "late": true
    }

    let earlycallbackcalled = false
    let c = await call.newuac( options, { "early": ( c ) => earlycallbackcalled = true } )

    c.hangup()

    expect( earlycallbackcalled ).to.be.true
  } )

  it( `uas.newuac - confirmed callback is called`, async function() {
    let srfscenario = new srf.srfscenario( {} )

    let options = {
      "contact": "ourcontactstring",
      "late": true
    }

    let earlycallbackcalled = false
    let c = await call.newuac( options, { "confirm": ( c ) => earlycallbackcalled = true } )

    c.hangup()

    expect( earlycallbackcalled ).to.be.true
  } )

  it( `uas.newuac - simple update`, async function() {
    let srfscenario = new srf.srfscenario( {} )

    let options = {
      "contact": "ourcontactstring",
      "late": true
    }

    let earlycallbackcalled = false
    let c = await call.newuac( options )

    /* mock */
    c._req.set( "ALLOW", "INVITE, UPDATE, OPTIONS" )
    let requestoptions
    c._dialog.on( "request", ( options ) => requestoptions = options )

    await c.update( { "remote": {
      "display": "Kermit",
      "realm": "muppetshow.com",
      "username": "kermy"
    } } )

    c.hangup()

    expect( requestoptions.method ).to.equal( "update" )
    expect( requestoptions.body ).to.be.a( "string" )
    expect( requestoptions.headers[ "P-Preferred-Identity" ] ).to.equal( `"Kermit" <sip:kermy@muppetshow.com>` )

  } )

  it( `uas.newuac - simple update - but don't allow as not in allow`, async function() {
    let srfscenario = new srf.srfscenario( {} )

    let options = {
      "contact": "ourcontactstring",
      "late": true
    }

    let earlycallbackcalled = false
    let c = await call.newuac( options )

    /* mock */
    let requestoptions = false
    c._dialog.on( "request", ( options ) => requestoptions = options )

    let returnedval = await c.update( { "remote": {
      "display": "Kermit",
      "realm": "muppetshow.com",
      "username": "kermy"
    } } )

    c.hangup()

    expect( returnedval ).to.be.false
    expect( requestoptions ).to.be.false
  } )
} )
