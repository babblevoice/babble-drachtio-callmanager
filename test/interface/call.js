
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )

const clearcallmanager = require( "../../lib/callmanager.js" )._clear

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
} )
