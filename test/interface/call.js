
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )
const projectrtp = require( "@babblevoice/projectrtp" ).projectrtp
const projectrtpmessage = require( "@babblevoice/projectrtp/lib/message.js" )
const net = require( "net" )

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

  it( "uas.newuac - create uas", async function() {

    const srfscenario = new srf.srfscenario()

    let newcallcalled = false
    srfscenario.options.em.on( "call.new", ( /*newcall*/ ) => {
      newcallcalled = true
    } )

    const call = await new Promise( ( resolve ) => {
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

    expect( newcallcalled ).to.be.true
    expect( call ).to.have.property( "uuid" ).that.is.a( "string" )
    expect( call ).to.have.property( "type" ).that.is.a( "string" ).to.equal( "uas" )
    expect( call ).to.have.property( "state" ).that.is.a( "object" )
    expect( call.state ).to.have.property( "trying" ).that.is.a( "boolean" ).to.be.false
    expect( call.state ).to.have.property( "ringing" ).that.is.a( "boolean" ).to.be.false
    expect( call.state ).to.have.property( "established" ).that.is.a( "boolean" ).to.be.false
    expect( call.state ).to.have.property( "canceled" ).that.is.a( "boolean" ).to.be.false
    expect( call.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.true

    expect( call ).to.have.property( "children" ) // Set - how do you test?
    expect( call ).to.have.property( "parent" ).that.is.undefined

    expect( call ).to.have.property( "vars" ).that.is.a( "object" )

    expect( call ).to.have.property( "epochs" ).that.is.a( "object" )
    expect( call.epochs ).to.have.property( "startat" ).that.is.a( "number" )
    expect( call.epochs ).to.have.property( "answerat" ).that.is.a( "number" )
    expect( call.epochs ).to.have.property( "endat" ).that.is.a( "number" )

    expect( call ).to.have.property( "channels" ).that.is.a( "object" )
    expect( call.channels ).to.have.property( "audio" ).to.be.undefined

    /* if uas */
    expect( call ).to.have.property( "network" ).that.is.a( "object" )
    expect( call.network ).to.have.property( "remote" ).that.is.a( "object" )
    expect( call.network.remote ).to.have.property( "address" ).that.is.a( "string" )
    expect( call.network.remote ).to.have.property( "port" ).that.is.a( "number" )
    expect( call.network.remote ).to.have.property( "protocol" ).that.is.a( "string" )
    expect( call ).to.have.property( "sip" ).that.is.a( "object" )
    expect( call.sip ).to.have.property( "callid" ).that.is.a( "string" )
    expect( call.sip ).to.have.property( "tags" ).that.is.a( "object" )
    expect( call.sip.tags ).to.have.property( "remote" ).that.is.a( "string" )
    expect( call.sip.tags ).to.have.property( "local" ).that.is.a( "string" )

    expect( call.hangup_cause.reason ).to.equal( "NORMAL_CLEARING" )
    expect( call.hangup_cause.sip ).to.equal( 487 )

    expect( call.state.cleaned ).to.be.true

    /* defaults are loaded from call manager */
    expect( call.options.preferedcodecs ).to.equal( "g722 ilbc pcmu pcma" )

  } )

  it( "uas.newuac - create uac", async function() {

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

    const child = await call.newuac( { "contact": "1000@dummy" } )

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

    /* Hanging up child does not hangup parent */
    await child.hangup()
    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 1,
      "storebyuuid": 1,
      "storebyentity": 0
    } )

    /* Hangup parent */
    await call.hangup()

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

    expect( child.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.true

    expect( call.state.cleaned ).to.be.true
    expect( child.state.cleaned ).to.be.true

  } )

  it( "uas.newuac - create uac by entity no registrar", async function() {
    const srfscenario = new srf.srfscenario()

    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    const child = await call.newuac( { "entity": { "uri": "1000@dummy" } } )
    expect( child ).to.be.false

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

    expect( call.state.cleaned ).to.be.true
  } )

  it( "uas.newuac - create uac by entity with registrar", async function() {

    const options = {
      "registrar": {
        "contacts": async ( /* entity */ ) => {
          return {
            "username": "1000",
            "realm": "dummy.com",
            "display": "Bob",
            "uri": "1000@dummy.com",
            "contacts": [ { "contact": "sip:1000@dummy.com:5060" }, { "contact": "sip:1000@dummy.com:5060;transport=blah" } ]
          }
        }
      }
    }

    const srfscenario = new srf.srfscenario( options )

    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    call._req.setparsedheader( "remote-party-id", {
      "name": "",
      "uri": "",
      "user": "0123456789",
      "host": "someotherrealm.com",
      "params": { "privacy": false },
      "type": "callerid"
    } )

    const child = await call.newuac( { "entity": { "uri": "1000@dummy" } } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 2,
      "storebyuuid": 2,
      "storebyentity": 1
    } )

    const e = await child.entity
    expect( e.ccc ).to.equal( 1 )

    /* mock */
    let requestoptions = false

    child.parseallow( { get:() => { return "INVITE, UPDATE, OPTIONS" } } )
    child._dialog.on( "request", ( options ) => requestoptions = options )

    child.update()

    expect( requestoptions.method ).to.equal( "UPDATE" )
    expect( requestoptions.headers[ "P-Asserted-Identity" ] ).to.equal( "\"\" <sip:0123456789@someotherrealm.com>" )

    await call.hangup()

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

    expect( srfscenario.options.srf._createuaccount ).to.equal( 2 )

    expect( call.state.cleaned ).to.be.true
    expect( child.state.cleaned ).to.be.true

  } )

  it( "uas.newuac - create uac by entity with max limit and registrar", async function() {

    const options = {
      "registrar": {
        "contacts": async ( /* entity */ ) => {
          return {
            "username": "1000",
            "realm": "dummy.com",
            "display": "Bob",
            "uri": "1000@dummy.com",
            "contacts": [ { "contact": "sip:1000@dummy.com:5060" }, { "contact": "sip:1000@dummy.com:5060;transport=blah" } ]
          }
        }
      }
    }

    const srfscenario = new srf.srfscenario( options )

    const inboundcall = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    const child = await inboundcall.newuac( { "entity": { "uri": "1000@dummy", "max": 1 } } )

    const child2 = await call.newuac( { "entity": { "uri": "1000@dummy", "max": 1 } } )
    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 2,
      "storebyuuid": 2,
      "storebyentity": 1
    } )

    const child3newcalls = []
    await call.newuac( { "entity": { "uri": "1000@dummy" } }, { early:( c ) => child3newcalls.push( c ) } )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 4,
      "storebyuuid": 4,
      "storebyentity": 1
    } )

    await Promise.all( [
      child3newcalls[ 0 ].hangup(),
      child3newcalls[ 1 ].hangup()
    ] )

    await inboundcall.hangup()

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

    expect( srfscenario.options.srf._createuaccount ).to.equal( 4 )
    expect( child2 ).to.be.false

    expect( child.state.cleaned ).to.be.true
    expect( child3newcalls[ 0 ].state.cleaned ).to.be.true
    expect( child3newcalls[ 1 ].state.cleaned ).to.be.true

  } )

  it( "uas.newuac detatch from parent", async function() {

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

    const child = await call.newuac( { "contact": "1000@dummy" } )

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

    expect( call.state.cleaned ).to.be.true
    expect( child.state.cleaned ).to.be.true
  } )

  it( "uas.newuac - 486", async function() {

    const srfscenario = new srf.srfscenario()
    srfscenario.oncreateUAC( () => {
      throw { "status": 486 }
    } )

    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    const children = [] 
    const child = await call.newuac( { "contact": "1000@dummy" }, { "early": ( c ) => {
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

    expect( call.state.cleaned ).to.be.true
    expect( child.state.cleaned ).to.be.true
  } )


  it( "uas.newuac - timeout", async function() {

    const srfscenario = new srf.srfscenario()
    srfscenario.options.srf.newuactimeout = 20 /* longer than our uactimeout */

    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    const children = [] 
    const child = await call.newuac( { "contact": "1000@dummy", "uactimeout": 10 }, { "early": ( c ) => {
      children.push( c )
    }
    } ) /* overide default - very short */

    expect( child.destroyed ).to.be.true
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

    expect( call.state.cleaned ).to.be.true
    expect( child.state.cleaned ).to.be.true
  } )

  it( "uas.newuac - child remote hangup", async function() {

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

    const child = await call.newuac( { "contact": "1000@dummy" } )

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

    expect( call.state.cleaned ).to.be.true
    expect( child.state.cleaned ).to.be.true

  } )

  it( "uas.newuac - new call event", async function() {

    const srfscenario = new srf.srfscenario()

    let eventhappened = false
    srfscenario.options.em.on( "call.new", ( c ) => {
      expect( c ).to.be.an.instanceof( call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true
    } )

    const inbound = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    expect( eventhappened ).to.be.true

    await inbound.hangup()
  } )

  it( "uas.newuac - ringing event", async function() {

    const srfscenario = new srf.srfscenario()

    let eventhappened = false
    srfscenario.options.em.on( "call.ringing", ( c ) => {
      expect( c ).to.be.an.instanceof( call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true

    } )

    const c = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    /* signal ringing (this would normally come from the other side) */
    c.ring()

    expect( eventhappened ).to.be.true

    await c.hangup()

  } )

  it( "uas.newuac - destroyed event", async function() {

    const srfscenario = new srf.srfscenario()

    let eventhappened = false

    const c = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    c.on( "call.destroyed", ( /*c*/ ) => {
      eventhappened = true
    } )

    expect( eventhappened ).to.be.false
    await c.hangup()
    expect( eventhappened ).to.be.true
  } )

  it( "uas.newuac - answered and destroyed event", async function() {

    const srfscenario = new srf.srfscenario()

    let eventhappened = false
    srfscenario.options.em.on( "call.answered", ( c ) => {
      expect( c ).to.be.an.instanceof( call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true
    } )

    srfscenario.options.em.on( "call.destroyed", ( /*c*/ ) => {
      eventhappened = false
    } )

    const c = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    /* signal answered (this could be called for a ivr or a bridged call) */
    await c.answer()

    expect( eventhappened ).to.be.true

    await c.hangup()

    expect( eventhappened ).to.be.false
  } )

  it( "uas.newuac - authed event", async function() {

    const options = {
      "userlookup": async ( username, realm ) => {
        return {
          "secret": "zanzibar",
          "username": username,
          "realm": realm
        }
      }
    }

    const srfscenario = new srf.srfscenario( options )

    let eventhappened = false
    srfscenario.options.em.on( "call.authed", ( c ) => {
      expect( c ).to.be.an.instanceof( call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true
    } )

    const c = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => {
        resolve( call )
      } )
      srfscenario.inbound()
    } )

    let onsendcount = 0

    /* mock - auth example from https://datatracker.ietf.org/doc/html/draft-smith-sipping-auth-examples-01 3.3*/
    c._req.msg.uri = "sip:bob@biloxi.com"
    c._req.setparsedheader( "from", { "params": { "tag": "767sf76wew" }, "uri": "sip:bob@biloxi.com", "host": "biloxi.com" } )

    c._res.onsend( ( code, /*msg*/ ) => {

      if( 407 == code ) {

        c._auth._nonce = "dcd98b7102dd2f0e8b11d0f600bfb0c093"
        c._auth._opaque = "5ccc069c403ebaf9f0171e9517f40e41"
        
        /* We would normally look here to get nonce and opaque - howevere we are frigging it */
        //let request = msg.headers[ "Proxy-Authenticate" ]
        let request = "Digest realm=\"biloxi.com\", algorithm=MD5, qop=\"auth\", nonce=\"dcd98b7102dd2f0e8b11d0f600bfb0c093\", opaque=\"5ccc069c403ebaf9f0171e9517f40e41\", stale=false"

        /* The items a uac will add */
        request += ", username=\"bob\", nc=00000001,cnonce=\"0a4f113b\","
        request += " uri=\"sip:bob@biloxi.com\","
        request += " response=\"89eb0059246c02b2f6ee02c7961d5ea3\""

        srfscenario.req.set( "Proxy-Authorization", request )


        c._onauth( srfscenario.req, srfscenario.res )

      }

      onsendcount++
    } )

    /* signal answered (this could be called for a ivr or a bridged call) */
    let shouldnothappen = false
    try{ 
      await c.auth()
    } catch( e ) {
      shouldnothappen = true
    }
    await c.hangup()

    expect( eventhappened ).to.be.true
    expect( shouldnothappen ).to.be.false
    expect( c.hangup_cause.reason ).to.equal( "NORMAL_CLEARING" )
    expect( c.hangup_cause.src ).to.equal( "us" )
    expect( c.state.destroyed ).to.equal( true )
    expect( c.state.authed ).to.equal( true )
    const e = await c.entity
    expect( e.username ).to.equal( "bob" )
    expect( e.realm ).to.equal( "biloxi.com" )
    expect( e.uri ).to.equal( "bob@biloxi.com" )
    expect( onsendcount ).to.equal( 2 )

  } )

  it( "uas.newuac - auth failed", async function() {

    const options = {
      "userlookup": async ( username, realm ) => {
        return {
          "secret": "zanzibar",
          "username": username,
          "realm": realm
        }
      }
    }

    const srfscenario = new srf.srfscenario( options )

    let eventhappened = false
    srfscenario.options.em.on( "call.authed.failed", ( c ) => {
      expect( c ).to.be.an.instanceof( call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
      eventhappened = true
    } )

    const c = await new Promise( ( resolve ) => {
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
            request += ", username=\"bob\", nc=00000001,cnonce=\"0a4f113b\","
            request += " uri=\"sip:bob@biloxi.com\","
            request += " response=\"89eb0059246c02b2f6ee02c7961d5ea\""

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

    await c.waitforhangup()

    expect( eventhappened ).to.be.true
    expect( c.hangup_cause.reason ).to.equal( "FORBIDDEN" )
    expect( c.hangup_cause.src ).to.equal( "us" )
    expect( c.state.destroyed ).to.equal( true )
    expect( c.state.authed ).to.equal( false )
  } )

  it( "uas.newuac - caller id set correctly", async function() {

    const srfscenario = new srf.srfscenario( {} )

    let createuacoptions
    srfscenario.oncreateUAC( ( contact, options, /*callbacks*/ ) => {
      createuacoptions = options

    } )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    await call.newuac( options, { "early": ( c ) => c.hangup() } )

    expect( createuacoptions.headers[ "Remote-Party-ID" ] ).to.equal( "\"\" <sip:0000000000@localhost.localdomain>" )
    expect( createuacoptions.noAck ).to.be.true
  } )

  it( "uas.newuac - early callback is called", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    let earlycallbackcalled = false
    const c = await call.newuac( options, { "early": ( /*c*/ ) => earlycallbackcalled = true } )

    c.hangup()

    expect( earlycallbackcalled ).to.be.true
  } )

  it( "uas.newuac - confirmed callback is called", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    let earlycallbackcalled = false
    const c = await call.newuac( options, { "confirm": ( /*c*/ ) => earlycallbackcalled = true } )

    c.hangup()

    expect( earlycallbackcalled ).to.be.true
  } )

  it( "uas.newuac - simple update", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    const c = await call.newuac( options )

    /* mock */
    c.parseallow( { get:() => { return "INVITE, UPDATE, OPTIONS" } } )
    let requestoptions
    c._dialog.on( "request", ( options ) => requestoptions = options )

    await c.update( { "remote": {
      "display": "Kermit",
      "realm": "muppetshow.com",
      "username": "kermy"
    } } )

    c.hangup()

    expect( requestoptions.method ).to.equal( "UPDATE" )
    expect( requestoptions.body ).to.be.a( "string" )
    expect( requestoptions.headers[ "P-Asserted-Identity" ] ).to.equal( "\"Kermit\" <sip:kermy@muppetshow.com>" )

  } )

  it( "uas.newuac - simple update - but don't allow as not in allow", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    const c = await call.newuac( options )

    /* mock */
    let requestoptions = false
    c._dialog.on( "request", ( options ) => requestoptions = options )

    const returnedval = await c.update( { "remote": {
      "display": "Kermit",
      "realm": "muppetshow.com",
      "username": "kermy"
    } } )

    c.hangup()

    expect( returnedval ).to.be.false
    expect( requestoptions ).to.be.false
  } )

  it( "Test listen and emit event on call object", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    const c = await call.newuac( options )

    let eventfired = false
    c.on( "somerandomevent", ( ob ) => {
      if( "hello" === ob.vars.xinfo ) eventfired = true
    } )

    c.vars.xinfo = "hello"
    c.emit( "somerandomevent" )
    c.hangup()

    expect( eventfired ).to.be.true

  } )

  it( "Test listen and emit event on and removealllisteners call object", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    const c = await call.newuac( options )

    let eventfired = 0
    c.on( "somerandomevent", ( ob ) => {
      if( "hello" === ob.vars.xinfo ) eventfired++
    } )

    c.vars.xinfo = "hello"
    c.emit( "somerandomevent" )
    c.removealllisteners( "somerandomevent" )
    c.emit( "somerandomevent" )

    c.hangup()

    expect( eventfired ).to.be.equal( 1 )

  } )

  it( "Test listen and emit event on and removealllisteners (none specified) call object", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    const c = await call.newuac( options )

    let eventfired = 0
    c.on( "somerandomevent", ( ob ) => {
      if( "hello" === ob.vars.xinfo ) eventfired++
    } )

    c.vars.xinfo = "hello"
    c.emit( "somerandomevent" )
    c.removealllisteners()
    c.emit( "somerandomevent" )

    c.hangup()

    expect( eventfired ).to.be.equal( 1 )

  } )

  it( "Test listen and emit event on and off call object", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    const c = await call.newuac( options )

    let eventfired = 0

    const ourcb = ( ob ) => {
      if( "hello" === ob.vars.xinfo ) eventfired++
    }
    c.on( "somerandomevent", ourcb )

    c.vars.xinfo = "hello"
    c.emit( "somerandomevent" )
    c.off( "somerandomevent", ourcb )
    c.emit( "somerandomevent" )

    c.hangup()

    expect( eventfired ).to.be.equal( 1 )

  } )

  it( "Test listen and emit event once call object", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    const c = await call.newuac( options )

    let eventfired = 0
    c.once( "somerandomevent", ( ob ) => {
      if( "hello" === ob.vars.xinfo ) eventfired++
    } )

    c.vars.xinfo = "hello"
    c.emit( "somerandomevent" )
    c.emit( "somerandomevent" )
    c.hangup()

    expect( eventfired ).to.be.equal( 1 )

  } )

  it( "Test listen and emit call.pick on call object", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    const c = await call.newuac( options )

    let eventfired = false
    c.on( "call.pick", ( /*callobject*/ ) => {
      eventfired = true
    } )

    c.pick()
    c.hangup()

    expect( eventfired ).to.be.true

  } )

  it( "Create a call and mock rtpengine and ensure we receive events", async function() {
    new srf.srfscenario( {} )
    const rtpserver = await callmanager.projectrtp.proxy.listen()

    const connection = net.createConnection( 9002, "127.0.0.1" )
      .on( "error", ( e ) => {
        console.error( e )
      } )

    connection.on( "connect", () => {
      /* announce our node */
      connection.write( projectrtpmessage.createmessage( {"status":{"channel":{"available":5000,"current":0},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d5c94"}} ) )
    } )

    const messagestate = projectrtpmessage.newstate()
    let msgid
    connection.on( "data", ( data ) => {
      projectrtpmessage.parsemessage( messagestate, data, ( msg ) => {
        if( "open" === msg.channel ) {
          msgid = msg.id
          setTimeout( () => connection.write( projectrtpmessage.createmessage( {"local":{"port":10008,"dtls":{"fingerprint":"Some fingerprint","enabled":false},"address":"192.168.0.141"},"id": msg.id, "uuid":"6d8ba7bb-44b9-4989-9aaf-5d938b496c49","action":"open","status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d5c94"}} ) ), 2 )
        } else if( "close" == msg.channel ) {
          connection.write( projectrtpmessage.createmessage( {"id": msgid,"uuid":"6d8ba7bb-44b9-4989-9aaf-5d938b496c49","action":"record","file":"/tmp/voicemail/recording/03039cdb-1949-407d-91d6-15ba6894955c.wav","event":"finished.channelclosed","filesize":160684,"emailed":true,"transcription":"test recording for voicemail","status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d5c94"}} ) )
          connection.write( projectrtpmessage.createmessage( {"id": msgid,"uuid":"6d8ba7bb-44b9-4989-9aaf-5d938b496c49","action":"close","reason":"requested","stats":{"in":{"mos":4.5,"count":586,"dropped":0,"skip":0},"out":{"count":303,"skip":0},"tick":{"meanus":124,"maxus":508,"count":597}},"status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d5c94"}} ) )
        }
      } )
    } )

    /* ensure we are connected */
    await new Promise( ( resolve ) => setTimeout( () => resolve(), 100 ) )

    /* this flow mimicks the flow associated with a voicemail being left */
    const c = await call.newuac( {
      "contact": "ourcontactstring"
    } )

    setTimeout( () => connection.write( projectrtpmessage.createmessage( {"id": msgid,"uuid":"6d8ba7bb-44b9-4989-9aaf-5d938b496c49","action":"play","event":"start","reason":"new","status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d5c94"}} ) ), 1 )
    setTimeout( () => connection.write( projectrtpmessage.createmessage( {"id": msgid,"uuid":"6d8ba7bb-44b9-4989-9aaf-5d938b496c49","action":"play","event":"end","reason":"completed","status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d5c94"}} ) ), 10 )
    c.channels.audio.play( { "files": [ { "wav": "/voicemail/greeting.wav", "alt": "greeting" } ] } )
    let ev = await c.waitforanyevent( { "action": "play", "event": "end" } )
    expect( ev.action ).to.equal( "play" )
    expect( ev.event ).to.equal( "end" )
    expect( ev.reason ).to.equal( "completed" )

    setTimeout( () => connection.write( projectrtpmessage.createmessage( {"id": msgid,"uuid":"6d8ba7bb-44b9-4989-9aaf-5d938b496c49","action":"play","event":"start","reason":"new","status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d5c94"}} ) ) )
    setTimeout( () => connection.write( projectrtpmessage.createmessage( {"id": msgid,"uuid":"6d8ba7bb-44b9-4989-9aaf-5d938b496c49","action":"play","event":"end","reason":"completed","status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d5c94"}} ) ) )
    c.channels.audio.play( { "files": [ { "wav": "/voicemail/boing.wav", "alt": "" } ] } )
    ev = await c.waitforanyevent( { "action": "play", "event": "end" } )
    expect( ev.action ).to.equal( "play" )
    expect( ev.event ).to.equal( "end" )
    expect( ev.reason ).to.equal( "completed" )

    setTimeout( () => connection.write( projectrtpmessage.createmessage( {"id": msgid,"uuid":"6d8ba7bb-44b9-4989-9aaf-5d938b496c49","action":"record","file":"/tmp/voicemail/recording/03039cdb-1949-407d-91d6-15ba6894955c.wav","event":"recording","status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d5c94"}} ) ), 5 )
    
    c.channels.audio.record( {
      "file": "/voicemail/jhjhjgjhgjg.wav",
      "maxduration": 120 * 1000,
      "numchannels": 1,
      "email": {
        "to": "test@example.com",
        "foruser": "1000",
        "from": "012345789"
      },
      "transcribe": true
    } )

    setTimeout( () => {
      /* hangup from client */
      c._onhangup( "wire" )
    }, 50 )

    ev = await c.waitforanyevent( { "action": "record", "event": /finished.*|\*/ }, 10000 )
    expect( ev.action ).to.equal( "record" )
    expect( ev.event ).to.equal( "finished.channelclosed" )
    expect( ev.transcription ).to.equal( "test recording for voicemail" )
    expect( ev.emailed ).to.be.true
    expect( ev.filesize ).to.equal( 160684 )

    connection.destroy()
    await rtpserver.destroy()
  } )

  it( "set get moh", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "late": true
    }

    const c = await call.newuac( options )

    const s = {
      "loop": true,
      "files": [
        { "wav": "some.wav" }
      ]
    }

    /* no default configured */
    expect( c.moh ).to.be.undefined
    c.moh = s

    expect( c._moh.loop ).to.equal( true )
    expect( c.moh.loop ).to.equal( true )

    c._onhangup( "wire" )

  } )

  it( "overide caller id name", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "callerid": {
        "name": "Hello"
      }
    }

    const c = await call.newuac( options )

    /* no default configured */
    expect( c.options.headers[ "Remote-Party-ID" ] ).to.equal( "\"Hello\" <sip:0000000000@localhost.localdomain>" )

    c._onhangup( "wire" )

  } )


  it( "overide caller id number", async function() {
    new srf.srfscenario( {} )

    const options = {
      "contact": "ourcontactstring",
      "callerid": {
        "number": "012345789"
      }
    }

    const c = await call.newuac( options )


    /* no default configured */
    expect( c.options.headers[ "Remote-Party-ID" ] ).to.equal( "\"\" <sip:012345789@localhost.localdomain>" )

    c._onhangup( "wire" )

  } )
} )
