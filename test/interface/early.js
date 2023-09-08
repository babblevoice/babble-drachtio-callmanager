

const { v4: uuidv4 } = require( "uuid" )
const expect = require( "chai" ).expect
const callmanager = require( "../../index.js" )
const srf = require( "../mock/srf.js" )

const projectrtpmessage = require( "@babblevoice/projectrtp/lib/message.js" )
const net = require( "net" )

const clearcallmanager = require( "../../lib/callmanager.js" )._clear

describe( "call early", function() {

  afterEach( function() {
    clearcallmanager()
  } )

  beforeEach( function() {
    clearcallmanager()
  } )


  it( "Create call and send 183 - early basic", async () => {

    /*
    Phone                 BV                   Gateway
    |---------INVITE------>|                      |(1)
    |                      |---------INVITE------>|(2)
    |                      |<--------183 (w-sdp)--|(3)
    |<--------183 (w-sdp)--|                      |(4)

    Phone RTP: 192.168.0.200:18540
    BV RTP: 192.168.0.141
    Gateway RTP: 192.168.0.160:21000
    */

    /* Setup the mock RTP server */ 
    const srfscenario = new srf.srfscenario()
    const rtpserver = await callmanager.projectrtp.proxy.listen()

    const connection = net.createConnection( 9002, "127.0.0.1" )
      .on( "error", ( e ) => {
        console.error( e )
      } )

    connection.on( "connect", () => {
      /* announce our node */
      connection.write( projectrtpmessage.createmessage( {"status":{"channel":{"available":5000,"current":0},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}} ) )
    } )

    let mixing
    const messagestate = projectrtpmessage.newstate()
    const channelmessages = []
    let opencount = 0
    
    connection.on( "data", ( data ) => {
      projectrtpmessage.parsemessage( messagestate, data, ( msg ) => {
        try{
          channelmessages.push( msg )
          if( "open" === msg.channel ) {
            if( 0 == opencount ) {
              setTimeout( () => 
                connection.write( 
                  projectrtpmessage.createmessage( 
                    {"local":{"port":10008,"dtls":
                      {"fingerprint":"Some fingerprint","enabled":false},
                    "address":"192.168.0.141"},
                    "id": msg.id, 
                    "uuid": uuidv4(),
                    "action":"open",
                    "status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}
                    } ) ), 2 )
            } else {
              setTimeout( () => 
                connection.write( 
                  projectrtpmessage.createmessage( 
                    {"local":{"port": 10010,"dtls":
                      {"fingerprint":"Some fingerprint","enabled":false},
                    "address":"192.168.0.141"},
                    "id": msg.id, 
                    "uuid": uuidv4(),
                    "action":"open",
                    "status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}
                    } ) ), 2 )
            }
            opencount++
          } else if ( "close" === msg.channel ) {
            connection.write( projectrtpmessage.createmessage( {"id": msg.id,"uuid":msg.uuid,"action":"close","reason":"requested","stats":{"in":{"mos":4.5,"count":586,"dropped":0,"skip":0},"out":{"count":303,"skip":0},"tick":{"meanus":124,"maxus":508,"count":597}}, "status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}
            } ) )
          } else if ( "mix" === msg.channel ) {
            mixing = true
          }
        } catch( e ) {
          console.error( e )
        }
      } )
    } )

    /* ensure we are connected */
    await new Promise( ( resolve ) => setTimeout( () => resolve(), 100 ) )

    srfscenario.oncreateUAC( async ( contact, options, callbacks ) => {

      /* Step 3. This is the mocked gateway message back to our newcall. */
      callbacks.cbProvisional( {
        "status": 183,
        "get": () => { return "INVITE, UPDATE, OPTIONS" },
        "msg": {
          "body": `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.160
t=0 0
m=audio 21000 RTP/AVP 0 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")
        }
      } )

      await new Promise( ( resolve ) => setTimeout( () => resolve(), 100 ) )
      throw { "status": 503 }
    } )

    /* Step 1. Phone sends INVITE */
    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound()
    } )

    /* Step 4. BV sends 183 back to phone */
    let msgsent, msginfo
    srfscenario.res.onsend( ( c, i ) => {
      msgsent = c
      msginfo = i
    } )


    /* Step 2. New INVITE to the remote Gateway */
    const newcall = await call.newuac( { "contact": "callto" } )
    
    await call._onhangup( "wire" )
    expect( newcall.state.early ).to.be.true
    expect( call.state.early ).to.be.true
    expect( mixing ).to.be.true
    expect( msgsent ).to.equal( 183 )

    expect( channelmessages[ 0 ].channel ).to.equal( "open" )
    expect( channelmessages[ 1 ].channel ).to.equal( "remote" )
    expect( channelmessages[ 1 ].remote.port ).to.equal( 21000 )
    expect( channelmessages[ 1 ].remote.address ).to.equal( "192.168.0.160" )
    expect( channelmessages[ 2 ].channel ).to.equal( "open" )
    expect( channelmessages[ 2 ].remote.port ).to.equal( 18540 )
    expect( channelmessages[ 2 ].remote.address ).to.equal( "192.168.0.200" )
    expect( channelmessages[ 3 ].channel ).to.equal( "mix" )
    expect( channelmessages[ 4 ].channel ).to.equal( "close" )
    expect( channelmessages[ 5 ].channel ).to.equal( "close" )

    expect( msginfo.body ).to.include( "audio 10010 RTP/AVP" )

    connection.destroy()
    rtpserver.destroy()
  } )

  it( "Create call and send 183 - early - SAVPF", async () => {

    /*
    Phone (SAVPF)         BV                   Gateway
    |---------INVITE------>|                      |(1)
    |                      |---------INVITE------>|(2)
    |                      |<--------183 (w-sdp)--|(3)
    |<--------183 (w-sdp)--|                      |(4)
    */

    /* Setup the mock RTP server */ 
    const srfscenario = new srf.srfscenario( { savpf: true } )
    const rtpserver = await callmanager.projectrtp.proxy.listen()

    const connection = net.createConnection( 9002, "127.0.0.1" )
      .on( "error", ( e ) => {
        console.error( e )
      } )

    connection.on( "connect", () => {
      /* announce our node */
      connection.write( projectrtpmessage.createmessage( {"status":{"channel":{"available":5000,"current":0},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}} ) )
    } )

    let mixing
    const messagestate = projectrtpmessage.newstate()
    const channelmessages = []
    let opencount = 0
    
    connection.on( "data", ( data ) => {
      projectrtpmessage.parsemessage( messagestate, data, ( msg ) => {
        try{
          channelmessages.push( msg )
          if( "open" === msg.channel ) {
            if( 0 == opencount ) {
              setTimeout( () => 
                connection.write( 
                  projectrtpmessage.createmessage( 
                    {"local":{"port":10008,"dtls":
                      {"fingerprint":"Some fingerprint","enabled":false},
                    "address":"192.168.0.141"},
                    "id": msg.id, 
                    "uuid": uuidv4(),
                    "action":"open",
                    "status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}
                    } ) ), 2 )
            } else {
              setTimeout( () => 
                connection.write( 
                  projectrtpmessage.createmessage( 
                    {"local":{"port": 10010,"dtls":
                      {"fingerprint":"Some fingerprint","enabled":false},
                    "address":"192.168.0.141"},
                    "id": msg.id, 
                    "uuid": uuidv4(),
                    "action":"open",
                    "status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}
                    } ) ), 2 )
            }
            opencount++
          } else if ( "close" === msg.channel ) {
            connection.write( projectrtpmessage.createmessage( {"id": msg.id,"uuid":msg.uuid,"action":"close","reason":"requested","stats":{"in":{"mos":4.5,"count":586,"dropped":0,"skip":0},"out":{"count":303,"skip":0},"tick":{"meanus":124,"maxus":508,"count":597}}, "status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}}))
          } else if ( "mix" === msg.channel ) {
            mixing = true
          }
        } catch( e ) {
          console.error( e )
        }
      } )
    } )

    /* ensure we are connected */
    await new Promise( ( resolve ) => setTimeout( () => resolve(), 100 ) )

    srfscenario.oncreateUAC( async ( contact, options, callbacks ) => {

      /* Step 3. This is the mocked gateway message back to our newcall. */
      callbacks.cbProvisional( {
        "status": 183,
        "msg": {
          "body": `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 0 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")
        }
      } )

      await new Promise( ( resolve ) => setTimeout( () => resolve(), 100 ) )
      throw { "status": 503 }
    } )

    /* Step 1. Phone sends INVITE */
    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )

      const req = new srf.req( { savpf: true } )
      req.setparsedheader( "contact", [ {
        name: undefined,
        uri: "sip:u3s2etdo@pc3lfsq1oh86.invalid;transport=ws;ob",
        params: {}
      }
      ] )

      srfscenario.inbound( req )
    } )

    /* Step 4. BV sends 183 back to phone */
    let msgsent, msginfo
    srfscenario.res.onsend( ( c, i ) => {
      msgsent = c
      msginfo = i
    } )


    /* Step 2. New INVITE to the remote Gateway */
    const newcall = await call.newuac( { "contact": "callto" } )
    
    await call._onhangup( "wire" )
    
    expect( newcall.state.early ).to.be.true
    expect( call.state.early ).to.be.true
    expect( mixing ).to.be.true
    expect( msgsent ).to.equal( 183 )

    expect( channelmessages[ 0 ].channel ).to.equal( "open" )
    expect( channelmessages[ 1 ].channel ).to.equal( "remote" )
    expect( channelmessages[ 1 ].remote.port ).to.equal( 20000 )
    expect( channelmessages[ 1 ].remote.address ).to.equal( "192.168.0.141" )
    expect( channelmessages[ 2 ].channel ).to.equal( "open" )
    expect( channelmessages[ 2 ].remote.port ).to.equal( 48356 )
    expect( channelmessages[ 3 ].channel ).to.equal( "mix" )
    expect( channelmessages[ 4 ].channel ).to.equal( "close" )
    expect( channelmessages[ 5 ].channel ).to.equal( "close" )

    expect( msginfo.body ).to.include( "UDP/TLS/RTP/SAVPF" )

    connection.destroy()
    rtpserver.destroy()
  } )


  it( "Create call and send 183 - early - SAVPF and 200 ok", async () => {

    /**
     * Markdown - mermaid
       sequenceDiagram
        participant Phone
        participant babble
        participant Gateway

        Phone->>babble: INVITE (1)
        babble->>Gateway: INVITE (2)
        Gateway->>babble: 183 w-sdp (3)
        babble->>Phone: 183 w-sdp (4)
        Gateway->>babble: Ok w-sdp (200)(5)
        babble->>Phone: Ok w-sdp (200) (6)
     */

    /* Setup the mock RTP server */ 
    const srfscenario = new srf.srfscenario( { savpf: true } )
    const rtpserver = await callmanager.projectrtp.proxy.listen()

    const connection = net.createConnection( 9002, "127.0.0.1" )
      .on( "error", ( e ) => {
        console.error( e )
      } )

    connection.on( "connect", () => {
      /* announce our node */
      connection.write( projectrtpmessage.createmessage( {"status":{"channel":{"available":5000,"current":0},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}} ) )
    } )

    let mixing
    const messagestate = projectrtpmessage.newstate()
    const channelmessages = []
    let opencount = 0
    
    connection.on( "data", ( data ) => {
      projectrtpmessage.parsemessage( messagestate, data, ( msg ) => {
        try{
          channelmessages.push( msg )
          if( "open" === msg.channel ) {
            if( 0 == opencount ) {
              setTimeout( () => 
                connection.write( 
                  projectrtpmessage.createmessage( 
                    {"local":{"port":10008,"dtls":
                      {"fingerprint":"Some fingerprint","enabled":false},
                    "address":"192.168.0.141"},
                    "id": msg.id, 
                    "uuid": uuidv4(),
                    "action":"open",
                    "status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}
                    } ) ), 2 )
            } else {
              setTimeout( () => 
                connection.write( 
                  projectrtpmessage.createmessage( 
                    {"local":{"port": 10010,"dtls":
                      {"fingerprint":"Some fingerprint","enabled":false},
                    "address":"192.168.0.141"},
                    "id": msg.id, 
                    "uuid": uuidv4(),
                    "action":"open",
                    "status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}
                    } ) ), 2 )
            }
            opencount++
          } else if ( "close" === msg.channel ) {
            connection.write( projectrtpmessage.createmessage( {"id": msg.id,"uuid":msg.uuid,"action":"close","reason":"requested","stats":{"in":{"mos":4.5,"count":586,"dropped":0,"skip":0},"out":{"count":303,"skip":0},"tick":{"meanus":124,"maxus":508,"count":597}}, "status":{"channel":{"available":4995,"current":5},"workercount":12,"instance":"ca0ef6a9-9174-444d-bdeb-4c9eb54d4566"}} ) )
          } else if ( "mix" === msg.channel ) {
            mixing = true
          }
        } catch( e ) {
          console.error( e )
        }
      } )
    } )

    /* ensure we are connected */
    await new Promise( ( resolve ) => setTimeout( () => resolve(), 100 ) )

    const req = new srf.req( { savpf: true } )
    req.setparsedheader( "contact", [ {
      name: undefined,
      uri: "sip:u3s2etdo@pc3lfsq1oh86.invalid;transport=ws;ob",
      params: {}
    }
    ] )

    srfscenario.oncreateUAC( async ( contact, options, callbacks ) => {

      /* Step 3. This is the mocked gateway message back to our newcall. */
      callbacks.cbProvisional( {
        "status": 183,
        "msg": {
          "body": `v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 0 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")
        }
      } )

      await new Promise( ( resolve ) => setTimeout( () => resolve(), 100 ) )
      return new srf.dialog( req )
    } )

    /* Step 1. Phone sends INVITE */
    const call = await new Promise( ( resolve ) => {
      srfscenario.oncall( async ( call ) => { resolve( call ) } )
      srfscenario.inbound( req )
    } )

    /* Step 4. BV sends 183 back to phone */
    let msgsent, msginfo
    srfscenario.res.onsend( ( c, i ) => {
      msgsent = c
      msginfo = i
    } )


    /* Step 2. New INVITE to the remote Gateway */
    const newcall = await call.newuac( { "contact": "callto" } )
    
    await new Promise( ( resolve ) => setTimeout( () => resolve(), 500 ) )
    await call._onhangup( "wire" )
    
    expect( newcall.state.early ).to.be.true
    expect( call.state.early ).to.be.true
    expect( mixing ).to.be.true
    expect( msgsent ).to.equal( 183 )

    expect( channelmessages[ 0 ].channel ).to.equal( "open" )
    expect( channelmessages[ 1 ].channel ).to.equal( "remote" )
    expect( channelmessages[ 1 ].remote.port ).to.equal( 20000 )
    expect( channelmessages[ 2 ].channel ).to.equal( "open" )
    expect( channelmessages[ 2 ].remote.port ).to.equal( 48356 )
    expect( channelmessages[ 2 ].remote.address ).to.equal( "82.19.206.102" )
    expect( channelmessages[ 3 ].channel ).to.equal( "mix" )
    /* with 183 we now get a second duplicate mix - this could be tidied but it is safe */
    expect( channelmessages[ 6 ].channel ).to.equal( "mix" )
    expect( channelmessages[ 7 ].channel ).to.equal( "close" )
    expect( channelmessages[ 8 ].channel ).to.equal( "close" )

    expect( msginfo.body ).to.include( "UDP/TLS/RTP/SAVPF" )

    connection.destroy()
    rtpserver.destroy()
  } )

} )