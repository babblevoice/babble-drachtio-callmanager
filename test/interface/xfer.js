
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )
const projectrtp = require( "@babblevoice/projectrtp" ).projectrtp

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear

describe( "xfer", function() {

  afterEach( function() {
    clearcallmanager()
  } )

  beforeEach( function() {
    clearcallmanager()
  } )

  it( `call blind xfer single leg should fail`, async function() {

    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let req = new srf.req( new srf.options() )
    let res = new srf.res()

    let sipcodesent, msgsent
    res.onsend( ( sipcode, msg ) => {
      sipcodesent = sipcode
      msgsent = msg
    } )

    await call.answer()

    call._dialog.callbacks.refer( req, res )

    await call.hangup()

    expect( sipcodesent ).to.equal( 400 )

  } )

  it( `call blind xfer 2 leg auth`, async function() {

    /*
    Client a                           Us                             Client b
    |--------------INVITE ------------>|                                  |(1)
    |<-------------407 proxy auth------|                                  |(2)
    |--------------INVITE w auth ----->|                                  |(3)
    |<-------------200 ok--------------|                                  |(4)
    |                                  |--------------INVITE ------------>|(5)
    |                                  |<-------------200 ok--------------|(6)
    |                                  |<-------------REFER --------------|(7)
    |                                  |--------------202 --------------->|(8)
    |                                  |--------------NOTIFY (100)------->|(9)
    |                                  |<-------------200 ----------------|(10)
    |                                  |--------------NOTIFY (200)------->|(11)
    |                                  |<-------------200 ----------------|(12)
    em.emit( "call.new", call )
    */

    let srfscenario = new srf.srfscenario()

    let call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let referedcall
    call.on( "call.referred", ( r ) => {
      referedcall = r
    } )

    let globalev
    srfscenario.options.em.on( "call.referred", ( r ) => {
      globalev = r
    } )

    let req = new srf.req( new srf.options() )
    let res = new srf.res()

    req.setparsedheader( "refer-to", { "uri": "sip:alice@atlanta.example.com" } )

    let sipcodesent, msgsent
    res.onsend( ( sipcode, msg ) => {
      sipcodesent = sipcode
      msgsent = msg
    } )

    await call.answer()
    let child = await call.newuac( { "contact": "1000@dummy" } )

    await child._dialog.callbacks.refer( req, res )

    await call.hangup()

    expect( call.hangup_cause.sip ).equal( 487 )
    expect( call.hangup_cause.src ).equal( "us" )
    expect( call.hangup_cause.reason ).equal( "NORMAL_CLEARING" )
    expect( child.hangup_cause.reason ).equal( "BLIND_TRANSFER" )

    expect( sipcodesent ).to.equal( 202 )

    /* should be the same call */
    expect( call.state.refered ).to.be.true
    expect( referedcall.state.refered ).to.be.true
    expect( referedcall.referingtouri ).to.equal( "sip:alice@atlanta.example.com" )

    expect( referedcall.referedby.uuid ).to.equal( child.uuid )
    expect( globalev.referedby.uuid ).to.equal( child.uuid )

    /* the child (the xferer) finishes with sending BYE */
    child._onhangup( "wire" )

  } )

  it( `call attended xfer 2 leg no auth`, async function() {
    /* using terminology referenced in call.js */
    let srfscenario = new srf.srfscenario()

    let b_1 = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let a_1 = await b_1.newuac( { "contact": "1000@dummy" } )

    let b_2 = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    let c_1 = await b_2.newuac( { "contact": "1001@dummy" } )

    /* now we refer b_2 to b_1 */
    let req = new srf.req( new srf.options() )
    let res = new srf.res()

    let xfermessages = []
    res.onsend( ( sipcode, msg ) => {
      xfermessages.push( {
        "code": sipcode,
        "msg": msg
      } )
    } )

    b_2._dialog.on( "request", ( options ) => {
      xfermessages.push( options )
    } )

    /* Refer-To: <sip:dave@denver.example.org?Replaces=12345%40192.168.118.3%3B
              to-tag%3D12345%3Bfrom-tag%3D5FFE-3994> */
    let callid = b_1.sip.callid
    let totag = b_1.sip.tags.local
    let fromtag = b_1.sip.tags.remote
    let referto = `sip:1000@dummy.com?Replaces=${callid}%3Bto-tag%3D${totag}%3Bfrom-tag%3D${fromtag}`
    req.setparsedheader( "refer-to", { "uri": referto } )

    await b_2._dialog.callbacks.refer( req, res )

    /* As part of the process the b_2 client will send us a hangup */
    await b_2._onhangup( "wire" )

    /* these two now have a chat before hanging up */
    await a_1.hangup()
    await c_1.hangup()

    expect( b_1.hangup_cause.sip ).equal( 487 )
    expect( b_1.hangup_cause.src ).equal( "us" )
    expect( b_1.hangup_cause.reason ).equal( "ATTENDED_TRANSFER" )

    expect( b_2.state.cleaned ).to.be.true
    expect( b_2.hangup_cause.sip ).equal( 487 )
    expect( b_2.hangup_cause.src ).equal( "wire" )
    expect( b_2.hangup_cause.reason ).equal( "ATTENDED_TRANSFER" )

    expect( a_1.state.refered ).to.be.true
    expect( a_1.hangup_cause.sip ).equal( 487 )
    expect( a_1.hangup_cause.src ).equal( "us" )
    expect( a_1.hangup_cause.reason ).equal( "NORMAL_CLEARING" )

    expect( c_1.hangup_cause.sip ).equal( 487 )
    expect( c_1.hangup_cause.src ).equal( "us" )
    expect( c_1.hangup_cause.reason ).equal( "NORMAL_CLEARING" )

    expect( xfermessages[ 0 ].code ).to.equal( 202 )
    expect( xfermessages[ 1 ].method ).to.equal( "NOTIFY" )
    expect( xfermessages[ 1 ].body ).to.include( "SIP/2.0 100" )
    expect( xfermessages[ 1 ].headers[ "Subscription-State" ] ).to.include( "active;expires" )
    expect( xfermessages[ 1 ].headers[ "Content-Type" ] ).to.equal( "message/sipfrag;version=2.0" )

    expect( xfermessages[ 2 ].method ).to.equal( "NOTIFY" )
    expect( xfermessages[ 2 ].body ).to.include( "SIP/2.0 200" )
    expect( xfermessages[ 2 ].headers[ "Subscription-State" ] ).to.equal( "terminated;reason=complete" )
    expect( xfermessages[ 2 ].headers[ "Content-Type" ] ).to.equal( "message/sipfrag;version=2.0" )

  } )
} )
