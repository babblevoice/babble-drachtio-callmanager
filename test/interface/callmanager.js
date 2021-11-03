
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const callstore = require( "../../lib/store.js" )

const clearcallmanager = require( "../../lib/callmanager.js" )._clear

const srf = require( "../mock/srf.js" )

/* All call objects should be created by the framework - but we create them to test */

describe( "callmanager", function() {

  beforeEach( function() {
    clearcallmanager()
  } )

  it( `create new callmanager object and present a simple call`, async function() {

    let req = new srf.req()
    req.setparsedheader( "call-id", "1234" )
    req.setparsedheader( "from", {
      "params": {
        "tag": "from-tag"
      }
    } )

    let usecalled = false
    let invitecb = false
    let options = {
      "srf": {
        "use": ( method, asynccb ) => {
          invitecb = asynccb
          usecalled = true
          expect( method ).to.equal( "invite" )
        }
      }
    }
    let c = await callmanager.callmanager( options )

    expect( usecalled ).to.be.true

    let res = {}
    let next = () => {}
    /* present our pretend call */
    await invitecb( req, res, next )

    /* We work out our entity when we auth the invite request */
    expect( await callstore.stats() ).to.deep.include( {
      "storebycallid": 1,
      "storebyuuid": 1,
      "storebyentity": 0
    } )
  } )


  it( `create new callmanager object request presence info`, async function() {

    let eventemitted = false
    await new Promise( async ( done ) => {

      let req = new srf.req()
      req.setparsedheader( "call-id", "1234" )
      req.setparsedheader( "from", {
        "params": {
          "tag": "from-tag"
        }
      } )

      let usecalled = false
      let invitecb = false
      let options = {
        "srf": {
          "use": ( method, asynccb ) => {
            invitecb = asynccb
            usecalled = true
            expect( method ).to.equal( "invite" )

          }
        },
        "userlookup": async function( user, realm ) {
          return {
            "display": "Miss Piggy",
          }
        }
      }
      let c = await callmanager.callmanager( options )
      expect( usecalled ).to.be.true

      let res = {}
      let next = () => {}
      /* present our pretend call */
      await invitecb( req, res, next )

      options.em.on( "presence.dialog.out", ( o ) => {
        eventemitted = true

        expect( o ).that.is.a( "object" )
        expect( o ).to.have.property( "entity" ).that.is.a( "string" ).to.equal( "1000@domain" )
        expect( o ).to.have.property( "display" ).that.is.a( "string" ).to.equal( "Miss Piggy" )

        done()
      } )

      options.em.emit( "presence.subscribe.in", { "contenttype": "application/dialog-info+xml", "entity": req.entity.uri } )
      } )
    expect( eventemitted ).to.be.true
  } )

  it( `check hangup codes on main interface`, async function() {
    expect( callmanager ).to.have.property( "hangupcodes" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "PAYMENT_REQUIRED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "OUTGOING_CALL_BARRED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "INCOMING_CALL_BARRED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "UNALLOCATED_NUMBER" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "NOT_ALLOWED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "NOT_ACCEPTABLE" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "PROXY_AUTHENTICATION" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "REQUEST_TIMEOUT" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "USER_GONE" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "TEMPORARILY_UNAVAILABLE" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "CALL_DOES_NOT_EXIST" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "LOOP_DETECTED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "TOO_MANY_HOPS" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "INVALID_NUMBER_FORMAT" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "AMBIGUOUS" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "USER_BUSY" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "NORMAL_CLEARING" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "ORIGINATOR_CANCEL" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "USER_NOT_REGISTERED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "BLIND_TRANSFER" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "ATTENDED_TRANSFER" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "LOSE_RACE" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "PICKED_OFF" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "REQUEST_TERMINATED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "INCOMPATIBLE_DESTINATION" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "SERVER_ERROR" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "FACILITY_REJECTED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "DESTINATION_OUT_OF_ORDER" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "BUSY_EVERYWHERE" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "DECLINED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "DOES_NOT_EXIST_ANYWHERE" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "UNWANTED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "REJECTED" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "SERVICE_UNAVAILABLE" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "SERVER_TIMEOUT" ).that.is.a( "object" )
    expect( callmanager.hangupcodes ).to.have.property( "MESSAGE_TOO_LARGE" ).that.is.a( "object" )

  } )
} )
