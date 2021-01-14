
/*
TODO

* In calls dict clean up when calls are hung up
*/

'use strict'

const assert = require( "assert" )
const events = require('events')
const digestauth = require( "drachtio-mw-digest-auth" )
const regparser = require( "drachtio-mw-registration-parser" )
const parseuri = require( "drachtio-srf" ).parseUri

/* RTP */
const projectrtp = require( "babble-projectrtp" ).ProjectRTP
const sdpgen = require( "babble-projectrtp" ).sdp
const { v4: uuidv4 } = require( "uuid" )

const rtp = new projectrtp()

class call {

  constructor( req, res ) {
    this.uuid = uuidv4()
    this.ringing = false
    this.established = false
    this.canceled = false
    this.destroyed = false
    this.type = "unknown"
    this.sdp = {}

    /* an array of channels */
    this.chs = []

    /* UACs we create */
    this.children = []
    this.parent = false

    if( undefined !== req ) {

      this.source_address = req.source_address
      this.sip = {}
      this.sip.callid = req.msg.headers[ "call-id" ]

      this.req = req
      this.res = res
      this.type = "uas"

      this.req.on( "cancel", () => this._oncanceled() )
    }
  }

  newuac( contact, from ) {

    let newcall = new call()
    newcall.type = "uac"
    newcall.parent = this
    this.children.push( newcall )

    var p = new Promise( ( resolve, reject ) => {
      newcall.newuacresolve = resolve
      newcall.newuacreject = reject
    } )

    singleton.options.srf.createUAC( contact, {
        headers: {
          "From": from
        },
        noAck: true
      },
      {
        cbRequest: ( err, req ) => {
          newcall.req = req
        },
        cbProvisional: ( res ) => {
          newcall.res = res
          if( 180 === res.status ) {
            newcall._onring()
          }
        }
      } )
      .then( ( dlg ) => {
        newcall.dialog = dlg
        newcall.sdp.remote = sdpgen.create( dlg.sdp )
        newcall.established = true
        newcall._onanswer()
      } )
      .catch( ( err ) => {

        if ( undefined !== err.status ) {
          switch( err.status ) {
            case 486: /* Busy here */
            case 487: /* Request terminated */
              console.log( "uac cancel")
              newcall._onhangup()
              break
            default:
              console.log( "unknown sip response: " + err.status )
          }
        } else {
          console.log( err )
        }
      } )

    return p
  }

  /* Called from newuac when we receive a 180 */
  _onring() {
    if( undefined !== this.parent ) {
      console.log( this.uuid + ": received 180 ringing" )
      this.parent.ring()
    }
  }

  /* Called from newuac when we are answered and we have a dialog, this - child call */
  _onanswer() {
    if( undefined !== this.parent ) {
      if( undefined !== this.parent.children ) {
        this.parent.children.forEach( ( child ) => {
          if( child.uuid !== this.uuid ) {
            child.hangup()
          }
        } )
      }
      this.parent.children = [ this ]
    }

    /* We now have 2 calls, we may need to answer the parent */
    /* We have this.dialog (srf dialog object) and this.sdp.remote (sdp object) */
    let remotecodecs = this.sdp.remote.intersection( singleton.options.preferedcodecs )
    console.log( this.uuid + ": remote codecs: " + remotecodecs )

    rtp.channel( this.sdp.remote.select( remotecodecs ) )
      .then( ch => {
        this.chs.push( ch )

        this.sdp.local = sdpgen.create().addcodecs( remotecodecs ).setchannel( ch )

        this.dialog.ack( this.sdp.local.toString() )
          .then( ( dlg ) => {
            this.dialog = dlg
            this.addevents( this.dialog )
          } )

        if( this.canceled ) {
          this.newuacreject()
          this._onhangup()
          return
        }

        if( this.parent.established ) {
          this.audio.mix( this.parent.audio )
          this.newuacresolve( this )
        } else {
          this.parent.answer()
            .then( () => {
              this.audio.mix( this.parent.audio )
              this.newuacresolve( this )
            } )
            .catch( () => {
              this.hangup()
              this.newuacreject( this )
            } )
        }
      } )
  }

  get destination() {
    return parseuri( this.req.msg.uri )
  }

  /*
    auth - returns promise.
  */
  auth() {
    var p = new Promise( ( resolve, reject ) => {
      this.authresolve = resolve
      this.authreject = reject
    } )

    var authed = false
    singleton.authdigest( this.req, this.res, () => { this.authresolve() } )
    return p
  }

  /* Private - called by us */
  _onauth( req, res ) {

    this.req = req
    this.res = res

    this.req.on( "cancel", () => this._oncanceled() )

    /* are we waiting for an auth ?*/
    if( undefined !== this.authresolve ) {
      console.log( "checking auth" )
      let authed = false
      singleton.authdigest( this.req, this.res, () => { authed = true } )

      if( authed ) {
        console.log( "resolving auth" )
        this.authresolve()

        console.log( "cleaning up auth" )
        delete this.authresolve
        delete this.authreject
      }
    }
  }

  _oncanceled( req, res ) {
    console.log( "client canceled" )
    this.canceled = true

    this.children.forEach( ( child ) => {
      child.hangup()
    } )
  }

  ring() {
    if( !this.ringing && "uas" === this.type ) {
      this.ringing = true
      this.res.send( 180 )
    }
  }

  busy() {
    this.res.send( 486 )
  }

  /*
    answer - returns promise.
    Answer the call and store a channel which can be used.
  */
  answer() {
    var p = new Promise( ( resolve, reject ) => {
      this.answerresolve = resolve
      this.answerreject = reject
    } )

    if( this.canceled ) {
      this.answerreject()
      return
    }

    this.sdp.remote = sdpgen.create( this.req.msg.body )
    let remotecodecs = this.sdp.remote.intersection( singleton.options.preferedcodecs )
    console.log( this.uuid + ": answer - remote codecs: " + remotecodecs )

    rtp.channel( this.sdp.remote.select( remotecodecs ) )
      .then( ch => {

        this.chs.push( ch )

        this.sdp.local = sdpgen.create().addcodecs( remotecodecs ).setchannel( ch )

        if( this.canceled ) {
          this.answerreject()
          this.hangup()
          return
        }

        singleton.options.srf.createUAS( this.req, this.res, {
          localSdp: this.sdp.local.toString()
        } )
        .then( ( dialog ) => {
          this.established = true
          this.dialog = dialog
          this.addevents( this.dialog )
          this.answerresolve()

          this.addevents( this.dialog )
        } )
        .catch( ( err ) => { this.answerreject() } )
      } )

    return p
  }

  addevents( dialog ) {
    dialog.on( "destroy", ( req ) => {
      console.log( this.uuid + ": we received destroy on the wire" )
      this._onhangup()
    } )

    dialog.on( "hold", ( req ) => {

    } )

    dialog.on( "unhold", ( req ) => {

    } )

    dialog.on( "refer", ( req, res ) => {

    } )

    dialog.on( "modify", ( req, res ) => {
      //  The application must respond, using the res parameter provided.
    } )
  }

  channels( cb ) {
    this.chs.forEach( ( ch ) => cb( ch ) )
    return this
  }

  /* TODO suport other types by searching for audio in channels list */
  get audio() {
    if( this.chs.length > 0 ) {
      return this.chs[ 0 ]
    }
    return
  }

  /* When our dialog has confirmed we have hung up */
  _onhangup() {
    console.log( this.uuid + ": on hangup" )

    this.established = false
    this.destroyed = true

    this.channels( ( ch ) => ch.destroy() )
    this.chs = []

    if( undefined !== this.source_address ) {
      singleton.calls[ this.source_address ].delete( this.sip.callid )
      if( 0 === singleton.calls[ this.source_address ].size ) {
        singleton.calls.delete( this.source_address )
      }
    }

    if( false !== this.parent ) {
      this.parent.hangup()
    }

    this.children.forEach( ( child ) => {
      child.hangup()
    } )
  }

  hangup() {

    if( this.destroyed ) {
      return
    }

    console.log( this.uuid + ": hanging up call by request" )

    if( this.established ) {
      this.dialog.destroy()
    } else if( "uac" === this.type ) {
      this.req.cancel()
    } else {
      this.res.send( 486 )
    }

    this._onhangup()
  }

  /*
  destination can be
  1000
  1000@bling.babblevoice.com
  sip:1000@bling.babblevoice.com
  */
  parsedestination( destination ) {
    if( "sip:" !== destination.substring( 0, 4 ) ) {
      destination = "sip:" + destination
    }

    if( -1 === str.indexOf( "@" ) ) {
      destination = destination + "@" + this.req.authorization.realm
    }
  }
}

var singleton
class callmanager {
  constructor( options ) {
    singleton = this

    this.options = {
      "preferedcodecs": "pcmu pcma 2833",
      "transcode": true
    }

    this.options = { ...this.options, ...options }

    this.authdigest = digestauth( {
      proxy: true, /* 407 or 401 */
      passwordLookup: options.passwordLookup
    } )

    this.options.srf.use( "invite", this.oninvite )

    this.em = new events.EventEmitter()

    /* Track inbound calls. Outbound calls are not stored here */
    this.calls = new Map()
  }

  on( event, cb ) {
    this.em.on( event, cb )
  }

  oninvite( req, res, next ) {

    if( req.method !== "INVITE" ) return next()

    /* Store the call by source address AND call id to prevent any possible (unlikely) clashing */
    if( undefined === singleton.calls[ req.source_address ] ) {
      singleton.calls[ req.source_address ] = new Map()
    }

    /* If we don't know about this call, store it then alert our dial plan */
    if( undefined === singleton.calls[ req.source_address ][ req.msg.headers[ "call-id" ] ] ) {
      let c = new call( req, res )
      singleton.calls[ req.source_address ][ req.msg.headers[ "call-id" ] ] = c
      singleton.em.emit( "call", c )
    } else {
      /* existing call... */
      let c = singleton.calls[ req.source_address ][ req.msg.headers[ "call-id" ] ]
      c._onauth( req, res )
    }

    return next()
  }
}

module.exports = callmanager
