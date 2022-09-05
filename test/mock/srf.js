
const expect = require( "chai" ).expect
const { v4: uuidv4 } = require( "uuid" )
const crypto = require( "crypto" )
const events = require( "events" )

const call = require( "../../lib/call.js" )
const callmanager = require( "../../index.js" )

let possiblesdp = [
  `v=0
o=Z 1610744131900 1 IN IP4 127.0.0.1
s=Z
c=IN IP4 192.168.0.200
t=0 0
m=audio 18540 RTP/AVP 106 9 98 101 0 8 18 3
a=rtpmap:106 opus/48000/2
a=fmtp:106 maxplaybackrate=16000; sprop-maxcapturerate=16000; minptime=20; cbr=1; maxaveragebitrate=20000; useinbandfec=1
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n"),
`v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 8 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n"),
`v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 0 101
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n"),
`v=0
o=- 1608235282228 0 IN IP4 127.0.0.1
s=
c=IN IP4 192.168.0.141
t=0 0
m=audio 20000 RTP/AVP 97 101
a=rtpmap:97 ilbc/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=fmtp:97 mode=20
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n"),
`v=0
o=Z 1610744131900 1 IN IP4 127.0.0.1
s=Z
c=IN IP4 192.168.0.200
t=0 0
m=audio 18540 RTP/AVP 106 98 101 0 8 18 3 9
a=rtpmap:106 opus/48000/2
a=fmtp:106 maxplaybackrate=16000; sprop-maxcapturerate=16000; minptime=20; cbr=1; maxaveragebitrate=20000; useinbandfec=1
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n"),
`v=0
o=Z 1610744131900 1 IN IP4 127.0.0.1
s=Z
c=IN IP4 192.168.0.200
t=0 0
m=audio 18540 RTP/AVP 106 98 101 0 8 97 18 3
a=rtpmap:106 opus/48000/2
a=fmtp:106 maxplaybackrate=16000; sprop-maxcapturerate=16000; minptime=20; cbr=1; maxaveragebitrate=20000; useinbandfec=1
a=rtpmap:98 telephone-event/48000
a=fmtp:98 0-16
a=rtpmap:97 ilbc/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=fmtp:97 mode=20
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")
]

let possiblesavpsdp = [
  `v=0
o=- 6278233949897424941 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS Aq3uReW2RJFKkrlg942QblHcszboGZx9dhvK
m=audio 48356 UDP/TLS/RTP/SAVPF 111 63 103 104 9 0 8 106 105 13 110 112 113 126
c=IN IP4 82.19.206.102
a=rtcp:9 IN IP4 0.0.0.0
a=candidate:79019993 1 udp 1686052607 82.19.206.102 48356 typ srflx raddr 172.17.0.1 rport 48356 generation 0 network-id 1
a=ice-ufrag:K8PO
a=ice-pwd:3RU9dMh3eDbYsfJIyQ4ki5va
a=ice-options:trickle
a=fingerprint:sha-256 73:D5:EC:C0:BF:A7:CA:42:1B:DE:B6:EA:CE:B9:D0:32:38:65:50:4A:27:BF:58:9A:DF:24:B2:10:53:58:88:B9
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=sendrecv
a=msid:Aq3uReW2RJFKkrlg942QblHcszboGZx9dhvK eaa81692-2187-4303-8e59-ed1bcb9591ee
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:63 red/48000/2
a=fmtp:63 111/111
a=rtpmap:103 ISAC/16000
a=rtpmap:104 ISAC/32000
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:106 CN/32000
a=rtpmap:105 CN/16000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:112 telephone-event/32000
a=rtpmap:113 telephone-event/16000
a=rtpmap:126 telephone-event/8000
a=ssrc:3789235955 cname:k129XMgcWznC/heR
a=ssrc:3789235955 msid:Aq3uReW2RJFKkrlg942QblHcszboGZx9dhvK eaa81692-2187-4303-8e59-ed1bcb9591ee`.replace(/(\r\n|\n|\r)/gm, "\r\n"),
`v=0
o=- 6278233949897424941 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS Aq3uReW2RJFKkrlg942QblHcszboGZx9dhvK
m=audio 30000 UDP/TLS/RTP/SAVPF 111 63 103 104 9 0 8 106 105 13 110 112 113 126
c=IN IP4 8.8.8.8
a=rtcp:9 IN IP4 0.0.0.0
a=candidate:79019993 1 udp 1686052607 8.8.8.8 30000 typ srflx raddr 172.17.0.1 rport 30000 generation 0 network-id 1
a=ice-ufrag:K8PO
a=ice-pwd:3RU9dMh3eDbYsfJIyQ4ki5va
a=ice-options:trickle
a=fingerprint:sha-256 73:D5:EC:C0:BF:A7:CA:42:1B:DE:B6:EA:CE:B9:D0:32:38:65:50:4A:27:BF:58:9A:DF:24:B2:10:53:58:88:B9
a=setup:actpass
a=mid:0
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=sendrecv
a=msid:Aq3uReW2RJFKkrlg942QblHcszboGZx9dhvK eaa81692-2187-4303-8e59-ed1bcb9591ee
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=rtcp-fb:111 transport-cc
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:63 red/48000/2
a=fmtp:63 111/111
a=rtpmap:103 ISAC/16000
a=rtpmap:104 ISAC/32000
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:106 CN/32000
a=rtpmap:105 CN/16000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:112 telephone-event/32000
a=rtpmap:113 telephone-event/16000
a=rtpmap:126 telephone-event/8000
a=ssrc:3789235955 cname:k129XMgcWznC/heR
a=ssrc:3789235955 msid:Aq3uReW2RJFKkrlg942QblHcszboGZx9dhvK eaa81692-2187-4303-8e59-ed1bcb9591ee`.replace(/(\r\n|\n|\r)/gm, "\r\n")
]


let sdpid = 0

/*
Mock req object
*/
class req {
  constructor( options = {} ) {
    this.parsedheaders = {}
    this.headers = {}

    this.source = "network"
    this.source_address = "127.0.0.1"
    this.source_port = 5060
    this.protocol = "udp"
    this.receivedOn = "192.168.0.141:9997"
    this.entity = {
      "uri": "1000@domain"
    }

    this.options = options

    this.callbacks = {}

    let sdp = possiblesdp[ sdpid % possiblesdp.length ]
    
    if( options.savpf ) {
      sdp = possiblesavpsdp[ sdpid % possiblesavpsdp.length ]
    }

    this.msg = {
      "body": sdp,
      method: "INVITE"
    }
    sdpid++

    this.set( "cseq", "1 INVITE" )
    this.set( "max-forwards", "70" )

    this.setparsedheader( "call-id", uuidv4() )

    /* copied object structure from srf */
    this.setparsedheader( "from", {
    "uri": "sip:1000@dummy.com;transport=UDP",
    "params": {
        "tag": crypto.randomBytes( 5 ).toString( "hex" )
      }
    } )
  }

  /* case insensative */
  getParsedHeader( header ) {
    return this.parsedheaders[ header.toLowerCase() ]
  }

  setparsedheader( header, value ) {
    this.parsedheaders[ header.toLowerCase() ] = value
  }

  get( header ) {
    return this.headers[ header.toLowerCase() ]
  }

  set( header, value ) {
    this.headers[ header.toLowerCase() ] = value
  }

  has( header ) {
    return header.toLowerCase() in this.headers || header.toLowerCase() in this.parsedheaders
  }

  on( event, cb ) {
    this.callbacks[ event ] = cb
  }

  /* returns undefined - checked https://drachtio.org/api#sip-request-cancel */
  cancel() {
    if( this.callbacks.cancel ) this.callbacks.cancel()
  }
}

class res {
  constructor() {
    this.callbacks = {
      "onsend": false
    }

    this.msg = {
      "body": possiblesdp[ sdpid % possiblesdp.length ],
      method: "INVITE"
    }
  }

  /* returns undefined - https://drachtio.org/api#sip-request */
  send( sipcode, msg, o, cb ) {
    if( this.callbacks.onsend ) {
      this.callbacks.onsend( sipcode, msg )
    }

    if( cb ) {
      cb()
      return this
    }
  }

  onsend( cb ) {
    this.callbacks.onsend = cb
  }
}

class options {
  constructor( method = "invite" ) {
    this.method = method
    this.uacsdp = possiblesdp[ 0 ]
    this.uassdp = possiblesdp[ 1 ]
  }
}

class dialog {
  constructor( req ) {

    let sdp = ""
    if( req ) {
      sdp = req.msg.body
    }
    this.remote = {
      "sdp": sdp
    }

    let fromtag = ""
    if( req ) {
      let from = req.getParsedHeader( "from" )
      fromtag = from.params.tag
    }

    this.sip = {
      "localTag": crypto.randomBytes( 5 ).toString( "hex" ),
      "remoteTag": fromtag
    }

    this.callbacks = {}
  }

  on( ev, cb ) {
    this.callbacks[ ev ] = cb
  }

  ack() {
    return this
  }

  destroy( cb ) {
    if( this.callbacks.destroy ) this.callbacks.destroy()

    if( cb ) {
      cb()
      return this
    }

    return new Promise( ( resolve ) => {
      resolve( this )
    } )
  }

  /*
  Confirmed - srf.dialog.request returns a promise
  https://drachtio.org/docs/api#Dialog+request (only if no call back is supplied though)
  */
  request( options, cb ) {

    if( this.callbacks.request ) this.callbacks.request( options )

    if( cb ) {
      cb()
      return this
    }

    return new Promise( ( resolve ) => {
      resolve( this )
    } )
  }

  /*
  Same as request - promise or not depending on callback supplied or not
  https://drachtio.org/docs/api#Dialog+modify
  */
  modify( options, cb ) {
    if( cb ) {
      cb()
      return this
    }

    return new Promise( ( resolve ) => {
      resolve( this )
    } )
  }
}

class srf {
  constructor() {

    this.callbacks = {
      "createuac": false,
      "createuas": false
    }

    this.newuactimeout = 0

    this._createuaccount = 0
  }

  use( method ) {
    expect( method ).to.equal( "invite" )
  }

  async createUAC( contact, options, callbacks ) {
    this._createuaccount++
    let _req = new req()

    /* create a default */
    callbacks.cbRequest( {}, _req )

    if( this.callbacks.createuac ) {
      return this.callbacks.createuac( contact, options, callbacks )
    }

    if( this.newuactimeout > 0 ) {
      await new Promise( ( resolve ) => { setTimeout( () => resolve(), this.newuactimeout ) } )
    }

    return new dialog( _req )
  }

  async createUAS( req, res, options ) {
    if( this.callbacks.createuas ) return this.callbacks.createuas( req, res, options )

    /* create a default */
    return new dialog()
  }
}

/*
1st attempt is bad becuase it is too difficult to see what the test is doing which
is bad testing.
Our setup of the test and our mock objects need to look simple and are easily explainable.
*/
class srfscenario {
  constructor( options = {} ) {
    /* every scenario we restart spd */
    sdpid = 0

    this.callbacks = {
      "trying": false,
      "ringing": false,
      "call": false
    }

    let defaultoptions = {
      "method": "invite",
      "uacsdp": possiblesdp[ 0 ],
      "uassdp": possiblesdp[ 1 ]
    }

    if( options.savpf ) {
      defaultoptions.uacsdp = possiblesavpsdp[ 0 ]
      defaultoptions.uassdp = possiblesavpsdp[ 1 ]
    }

    this.options = { ...defaultoptions, ...options }
    this.options.srf = new srf()

    this.options.em = new events.EventEmitter()

    callmanager.callmanager( this.options )
  }

  ontrying( cb ) {
    this.callbacks.trying = cb
  }

  onringing( cb ) {
    this.callbacks.ringing = cb
  }

  oncall( cb ) {
    this.callbacks.call = cb
  }

  oncreateUAC( cb ) {
    this.options.srf.callbacks.createuac = cb
  }

  oncreateUAS( cb ) {
    this.options.srf.callbacks.createuas = cb
  }

  /*
    simulate a new inbound call
  */
  inbound( ureq ) {
    if( this.callbacks.call ) {
      if( ureq ) {
        this.req = ureq
      } else {
        this.req = new req( new options() )
      }
      this.res = new res()

      let newcall = call.frominvite( this.req, this.res )
      this.callbacks.call( newcall )
        .catch( () => newcall.hangup() )
    }
  }
}


module.exports.req = req
module.exports.res = res
module.exports.dialog = dialog
module.exports.options = options
module.exports.srfscenario = srfscenario
