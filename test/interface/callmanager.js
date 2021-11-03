
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
    expect( callmanager.hangupcodes ).to.have.property( "REQUEST_TIMEOUT" ).that.is.a( "object" )
  } )
} )
