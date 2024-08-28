
const expect = require( "chai" ).expect
const call = require( "../../lib/call.js" )
const srf = require( "../mock/srf.js" )

/* These DO NOT form part of our interface */
const clearcallmanager = require( "../../lib/callmanager.js" )._clear

describe( "xfer", function() {

  afterEach( function() {
    clearcallmanager()
  } )

  beforeEach( function() {
    clearcallmanager()
  } )

  /* TODO - this needs fixing as it requires auth now 1 legged is expected to do something and checking a blind xfer happened */
  xit( "call blind xfer single leg should fail on auth", async function() {

    const srfscenario = new srf.srfscenario( {
      userlookup: () => {}
    } )

    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    const req = new srf.req( new srf.options() )
    const res = new srf.res()

    let sipcodesent
    res.onsend( ( sipcode ) => {
      sipcodesent = sipcode
    } )

    await call.answer()

    call._dialog.callbacks.refer( req, res )

    await call.hangup()

    expect( sipcodesent ).to.equal( 400 )
  } )

  it( "call blind xfer 2 leg no auth", async function() {

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
    em.emit( "call.referred", call )
    */

    const srfscenario = new srf.srfscenario()

    const call = await new Promise( ( resolve ) => {
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

    const req = new srf.req( new srf.options() )
    const res = new srf.res()

    req.setparsedheader( "refer-to", { "uri": "sip:alice@atlanta.example.com" } )

    let sipcodesent
    res.onsend( ( sipcode ) => {
      sipcodesent = sipcode
    } )

    await call.answer()
    const child = await call.newuac( { "contact": "1000@dummy" } )
    child.referauthrequired = false

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

  it( "call blind xfer 2 leg auth", async function() {

    /*
    Client a                           Us                             Client b
    |                                  |<--------------INVITE ------------|(1)
    |                                  |---------------407 auth --------->|(2)
    |                                  |<--------------200 ok-------------|(3)
    |                                  |<--------------INVITE w auth------|(4)
    |                                  |---------------200 ok------------>|(5)
    |<-------------INVITE -------------|                                  |(5)
    |--------------407 proxy auth----->|                                  |(6)
    |<-------------INVITE w auth ------|                                  |(7)
    |--------------200 ok------------->|                                  |(8)
    |                                  |<--------------REFER -------------|(9)
    |                                  |---------------407 -------------->|(10)
    |                                  |<--------------REFER w auth ------|(11)
    |                                  |---------------202 -------------->|(12)
    |                                  |---------------NOTIFY (100)------>|(13)
    |                                  |<--------------200 ---------------|(14)
    |                                  |---------------NOTIFY (200)------>|(15)
    |                                  |<--------------200 ---------------|(16)
    em.emit( "call.referred", call )
    */

    /* Step 1-4 */
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

    srfscenario.options.em.on( "call.authed", ( c ) => {
      expect( c ).to.be.an.instanceof( call )
      expect( c.type ).to.be.an( "string" ).to.be.equal( "uas" )
    } )

    const c = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => {
        resolve( call )
      } )
      srfscenario.inbound()
    } )

    /* mock -
    auth example from https://datatracker.ietf.org/doc/html/draft-smith-sipping-auth-examples-01 3.3*/
    c._req.msg.uri = "sip:bob@biloxi.com"
    c._req.setparsedheader( "from", { "params": { "tag": "767sf76wew" }, "uri": "sip:bob@biloxi.com", "host": "biloxi.com" } )

    c._res.onsend( ( code ) => {

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
    } )

    let referedcall
    c.on( "call.referred", ( r ) => {
      referedcall = r
    } )

    await c.auth()
    await c.answer()

    /* Step 5-8 */
    const child = await c.newuac( { "contact": "1000@dummy" } )

    /* Step 9-16 */
    const req = new srf.req( new srf.options() )
    const res = new srf.res()

    req.setparsedheader( "refer-to", { "uri": "sip:alice@atlanta.example.com" } )

    let sipcodesent

    req.msg.uri = "sip:bob@biloxi.com"
    req.setparsedheader( "from", { "params": { "tag": "767sf76wew" }, "uri": "sip:bob@biloxi.com", "host": "biloxi.com" } )

    res.onsend( ( code ) => {

      if( 407 == code ) {

        child._auth._nonce = "dcd98b7102dd2f0e8b11d0f600bfb0c093"
        child._auth._opaque = "5ccc069c403ebaf9f0171e9517f40e41"

        /* We would normally look here to get nonce and opaque - howevere we are frigging it */
        //let request = msg.headers[ "Proxy-Authenticate" ]
        let request = "Digest realm=\"biloxi.com\", algorithm=MD5, qop=\"auth\", nonce=\"dcd98b7102dd2f0e8b11d0f600bfb0c093\", opaque=\"5ccc069c403ebaf9f0171e9517f40e41\", stale=false"

        /* The items a uac will add */
        request += ", username=\"bob\", nc=00000001,cnonce=\"0a4f113b\","
        request += " uri=\"sip:bob@biloxi.com\","
        request += " response=\"89eb0059246c02b2f6ee02c7961d5ea3\""

        req.set( "Proxy-Authorization", request )

        /* make the test for auth simple by breaking nonce count check */
        child._auth._nonceuses = 0

        /* Step 10. auth response */
        child._onauth( srfscenario.req, srfscenario.res )
        return

      }
      sipcodesent = code
    } )

    await child._dialog.callbacks.refer( req, res )

    await c.hangup()

    expect( c.hangup_cause.sip ).equal( 487 )
    expect( c.hangup_cause.src ).equal( "us" )
    expect( c.hangup_cause.reason ).equal( "NORMAL_CLEARING" )
    expect( child.hangup_cause.reason ).equal( "BLIND_TRANSFER" )

    expect( sipcodesent ).to.equal( 202 )

    /* should be the same call */
    expect( c.state.refered ).to.be.true
    expect( referedcall.state.refered ).to.be.true
    expect( referedcall.referingtouri ).to.equal( "sip:alice@atlanta.example.com" )

    expect( referedcall.referedby.uuid ).to.equal( child.uuid )

    /* the child (the xferer) finishes with sending BYE */
    child._onhangup( "wire" )

  } )

  it( "call attended xfer 2 leg no auth", async function() {
    /* using terminology referenced in call.js */
    const srfscenario = new srf.srfscenario()

    const b_1 = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    const a_1 = await b_1.newuac( { "contact": "1000@dummy" } )

    const b_2 = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    /* needed for _dialog.on... */
    await b_2.answer()

    const c_1 = await b_2.newuac( { "contact": "1001@dummy" } )

    /* now we refer b_2 to b_1 */
    const req = new srf.req( new srf.options() )
    const res = new srf.res()

    const xfermessages = []
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
    const callid = b_1.sip.callid
    const totag = b_1.sip.tags.local
    const fromtag = b_1.sip.tags.remote
    const referto = `sip:1000@dummy.com?Replaces=${callid}%3Bto-tag%3D${totag}%3Bfrom-tag%3D${fromtag}`
    req.setparsedheader( "refer-to", { "uri": referto } )

    b_2.referauthrequired = false
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
