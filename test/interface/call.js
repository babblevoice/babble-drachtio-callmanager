
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )
const projectrtp = require( "projectrtp" ).projectrtp

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear
const callstore = require( "../../lib/store.js" )

/* some usable SDP */
let clienttestsdp = `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 8 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

let servertestsdp = `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.200
t=0 0
m=audio 18000 RTP/AVP 8 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")

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

  it( `create new call uas object`, async function() {

    /* We need to create a callmanager to create a call object */
    let options = {
      "srf": {
        "use": ( method, asynccb ) => {
          expect( method ).to.equal( "invite" )
        }
      }
    }
    await callmanager.callmanager( options )


    let req = new srf.req()
    req.setparsedheader( "call-id", "1234" )
    req.setparsedheader( "from", {
      "params": {
        "tag": "from-tag"
      }
    } )

    let c = new call.call( req, {} )

    expect( c ).to.have.property( "uuid" ).that.is.a( "string" )
    expect( c ).to.have.property( "type" ).that.is.a( "string" ).to.equal( "uas" )
    expect( c ).to.have.property( "state" ).that.is.a( "object" )
    expect( c.state ).to.have.property( "trying" ).that.is.a( "boolean" ).to.be.false
    expect( c.state ).to.have.property( "ringing" ).that.is.a( "boolean" ).to.be.false
    expect( c.state ).to.have.property( "established" ).that.is.a( "boolean" ).to.be.false
    expect( c.state ).to.have.property( "canceled" ).that.is.a( "boolean" ).to.be.false
    expect( c.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.false

    expect( c ).to.have.property( "children" ) // Set - how do you test for type?
    expect( c ).to.have.property( "parent" ).that.is.a( "boolean" ).to.be.false

    expect( c ).to.have.property( "uactimeout" ).that.is.a( "number" )

    expect( c ).to.have.property( "vars" ).that.is.a( "object" )

    expect( c ).to.have.property( "epochs" ).that.is.a( "object" )
    expect( c.epochs ).to.have.property( "startat" ).that.is.a( "number" )
    expect( c.epochs ).to.have.property( "answerat" ).that.is.a( "number" )
    expect( c.epochs ).to.have.property( "endat" ).that.is.a( "number" )

    expect( c ).to.have.property( "channels" ).that.is.a( "object" )
    expect( c.channels ).to.have.property( "audio" ).to.be.false

    /* if uas */
    expect( c ).to.have.property( "source" ).that.is.a( "object" )
    expect( c.source ).to.have.property( "address" ).that.is.a( "string" )
    expect( c.source ).to.have.property( "port" ).that.is.a( "number" )
    expect( c.source ).to.have.property( "protocol" ).that.is.a( "string" )
    expect( c ).to.have.property( "sip" ).that.is.a( "object" )
    expect( c.sip ).to.have.property( "callid" ).that.is.a( "string" )
    expect( c.sip ).to.have.property( "tags" ).that.is.a( "object" )
    expect( c.sip.tags ).to.have.property( "remote" ).that.is.a( "string" )
    expect( c.sip.tags ).to.have.property( "local" ).that.is.a( "string" )


  } )

  it( `create new call uac object`, async function() {

    /* We need to create a callmanager to create a call object */
    let options = {
      "srf": {
        "use": ( method, asynccb ) => {
          expect( method ).to.equal( "invite" )
        }
      }
    }
    await callmanager.callmanager( options )

    let c = new call.call()

    expect( c ).to.have.property( "uuid" ).that.is.a( "string" )
    expect( c ).to.have.property( "type" ).that.is.a( "string" ).to.equal( "uac" )
    expect( c ).to.have.property( "state" ).that.is.a( "object" )
    expect( c.state ).to.have.property( "trying" ).that.is.a( "boolean" ).to.be.false
    expect( c.state ).to.have.property( "ringing" ).that.is.a( "boolean" ).to.be.false
    expect( c.state ).to.have.property( "established" ).that.is.a( "boolean" ).to.be.false
    expect( c.state ).to.have.property( "canceled" ).that.is.a( "boolean" ).to.be.false
    expect( c.state ).to.have.property( "destroyed" ).that.is.a( "boolean" ).to.be.false

    expect( c ).to.have.property( "children" ) // Set - how do you test for type?
    expect( c ).to.have.property( "parent" ).that.is.a( "boolean" ).to.be.false

    expect( c ).to.have.property( "uactimeout" ).that.is.a( "number" )

    expect( c ).to.have.property( "vars" ).that.is.a( "object" )

    expect( c ).to.have.property( "epochs" ).that.is.a( "object" )
    expect( c.epochs ).to.have.property( "startat" ).that.is.a( "number" )
    expect( c.epochs ).to.have.property( "answerat" ).that.is.a( "number" )
    expect( c.epochs ).to.have.property( "endat" ).that.is.a( "number" )

    expect( c ).to.have.property( "channels" ).that.is.a( "object" )
    expect( c.channels ).to.have.property( "audio" ).to.be.false

    /* if uac */
    expect( c ).to.not.have.property( "source" ).that.is.a( "object" )
    expect( c ).to.not.have.property( "sip" ).that.is.a( "object" )

  } )


  it( `uas.newuac`, async function() {

    /* We need to create a callmanager to create a call object */
    let options = {
      "srf": {
        "use": ( method, asynccb ) => {
          expect( method ).to.equal( "invite" )
        },
        "createUAC": async ( contact, options, callbacks ) => {

          expect( callbacks ).to.have.property( "cbRequest" ).that.is.a( "function" )
          expect( callbacks ).to.have.property( "cbProvisional" ).that.is.a( "function" )

          let dialog = {
            "sip": {
              "localTag": "lkwefwiuwie",
              "remoteTag": "wkenckw3w3"
            },
            "remote": {
              "sdp": clienttestsdp
            },
            "destroy": () => {}
          }
          await new Promise( ( resolve, reject ) => { setTimeout( () => resolve(), 0 ) } )
          return dialog
        },

        "createUAS": async( ) => {
          let dialog = {
            "sip": {
              "localTag": "87dh3qhd82hd",
              "remoteTag": "dfskjfwf3f"
            },
            "remote": {
              "sdp": servertestsdp
            },
            "on": () => {},
            "destroy": () => {}
          }
          return dialog
        }
      }
    }
    await callmanager.callmanager( options )

    let req = new srf.req()
    req.setparsedheader( "call-id", "1234" )
    req.setparsedheader( "from", {
      "params": {
        "tag": "from-tag"
      }
    } )

    let c = new call.call( req, {} )

    let child = await c.newuac( "1000@dummy" )

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 2,
      "storebyuuid": 2,
      "storebyentity": 0
    } )

    await child.hangup()

    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 0,
      "storebyuuid": 0,
      "storebyentity": 0
    } )

  } )
} )
