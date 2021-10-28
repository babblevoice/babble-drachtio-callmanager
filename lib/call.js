
const { v4: uuidv4 } = require( "uuid" )
const events = require('events')

const url = require( "url" )
const querystring = require( "querystring" )

const digestauth = require( "drachtio-mw-digest-auth" )
const parseuri = require( "drachtio-srf" ).parseUri
const sdpgen = require( "babble-projectrtp" ).sdp
const callstore = require( "./store.js" )

/*
Enum for different reasons for hangup.
*/
const hangupcodes = {
  PAYMENT_REQUIRED: { "reason": "PAYMENT_REQUIRED", "sip": 402 },
  OUTGOING_CALL_BARRED: { "reason": "OUTGOING_CALL_BARRED", "sip": 403 },
  INCOMING_CALL_BARRED: { "reason": "INCOMING_CALL_BARRED", "sip": 403 },
  UNALLOCATED_NUMBER: { "reason": "UNALLOCATED_NUMBER", "sip": 404 },
  USER_BUSY: { "reason": "USER_BUSY", "sip": 406 },
  NO_USER_RESPONSE: { "reason": "NO_USER_RESPONSE", "sip": 408 }, /* Timeout */
  USER_GONE: { "reason": "USER_GONE", "sip": 410 },
  NO_ANSWER: { "reason": "NO_ANSWER", "sip": 480 }, /* Temporarily Unavailable */
  LOOP_DETECTED: { "reason": "LOOP_DETECTED", "sip": 482 },
  INVALID_NUMBER_FORMAT: { "reason": "INVALID_NUMBER_FORMAT", "sip": 484 },
  USER_BUSY: { "reason": "USER_BUSY", "sip": 486 },
  NORMAL_CLEARING: { "reason": "NORMAL_CLEARING", "sip": 487 },
  ORIGINATOR_CANCEL: { "reason": "ORIGINATOR_CANCEL", "sip": 487 },
  USER_NOT_REGISTERED: { "reason": "USER_NOT_REGISTERED", "sip": 487 },
  BLIND_TRANSFER: { "reason": "BLIND_TRANSFER", "sip": 487 },
  ATTENDED_TRANSFER: { "reason": "ATTENDED_TRANSFER", "sip": 487 },
  LOSE_RACE: { "reason": "LOSE_RACE", "sip": 487 },
  PICKED_OFF: { "reason": "PICKED_OFF", "sip": 487 },
  MANAGER_REQUEST: { "reason": "MANAGER_REQUEST", "sip": 487 },
  REQUEST_TERMINATED: { "reason": "REQUEST_TERMINATED", "sip": 487 },
  INCOMPATIBLE_DESTINATION: { "reason": "INCOMPATIBLE_DESTINATION", "sip": 488 },
  SERVER_ERROR: { "reason": "SERVER_ERROR", "sip": 500 },
  FACILITY_REJECTED: { "reason": "FACILITY_REJECTED", "sip": 501 },
  DESTINATION_OUT_OF_ORDER: { "reason": "DESTINATION_OUT_OF_ORDER", "sip": 502 },
  CALL_REJECTED: { "reason": "CALL_REJECTED", "sip": 603 }
}

const eventdefs = [ "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "#", "A", "B", "C", "D" ]
var consolelog = ( u, m ) => {}
var callmanager

/** @class */
class call {

/**
Construct our call object with all defaults, including a default UUID.
@constructs call
@param {object} [req] - the req object passed into us from Drachtio
@param {object} [res] - the res object passed into us from Drachtio
*/
  constructor( req, res ) {
    this.uuid = uuidv4()

    /**
    @enum {string} type "uas" | "uac"
    @summary The type (uac or uas) from our perspective.
    */
    this.type = "uac"

    /**
      @typedef {Object} callstate
      @property {boolean} trying
      @property {boolean} ringing
      @property {boolean} established
      @property {boolean} canceled
      @property {boolean} destroyed
      @property {boolean} held
    */

    /** @member {callstate} */
    this.state = {
      "trying": false,
      "ringing": false,
      "established": false,
      "canceled": false,
      "destroyed": false,
      "held": false
    }

    /**
    @member
    @summary Channels which have been created
    */
    this.channels = {
      "audio": false
    }

    /**
    @member
    @summary UACs we create
    */
    this.children = new Set()
    /**
    @member
    @summary Who created us
    */
    this.parent = false

    /**
    @member
    @summary timeout value obtained from options. The timeout when establishing our dialog.
    */
    this.uactimeout = callmanager.options.uactimeout

    /**
      @typedef {Object} epochs
      @property {number} startat UNIX timestamp of when the call was started (created)
      @property {number} answerat UNIX timestamp of when the call was answered
      @property {number} endat UNIX timestamp of when the call ended
    */

    /** @member {epochs} */
    this.epochs = {
      "startat": Math.floor( +new Date() / 1000 ),
      "answerat": 0,
      "endat": 0
    }

    /**
      @typedef {Object} entity
      @property {string} [username] username part
      @property {string} [realm] realm (domain) part
      @property {string} [uri] full uri
      @property {string} [display] how the user should be displayed
    */
    /**
    @member {entity}
    */
    this.entity = {}

    /**
    @member {object}
    @summary user definable object that allows other modules to store data in this call.
    */
    this.vars = {}

    /**
    @member {string}
    @private
    */
    this._receivedtelevents = ""

    /**
    @member {object}
    @private
    */
    this._promises = {
      "resolve": {
        "auth": false,
        "newuac": false,
        "answer": false,
        "hangup": false,
        "events": false
      },
      "reject": {
        "auth": false,
        "newuac": false,
        "answer": false,
        "hangup": false
      }
    }

    /**
    @member {object}
    @private
    */
    this._timers = {
      "auth": false,
      "newuac": false,
      "events": false
    }

    /**
    @member {object}
    @private
    */
    this._em = new events.EventEmitter()


    if( undefined !== req ) {
      /* We have received the INVITE */
      this.type = "uas"

      /**
        @typedef {Object} source
        @property {string} address
        @property {number} port
        @property {string} protocol
      */

      /** @member {source} */
      this.source = {
        "address": req.source_address,
        "port": req.source_port,
        "protocol": req.protocol
      }

      /**
        @typedef {Object} sipdialog
        @property {string} callid
        @property {object} tags
        @property {string} tags.local
        @property {string} tags.remote

      */

      /** @member {sipdialog} */
      this.sip = {
        "callid": req.getParsedHeader( "call-id" ),
        "tags": {
          "remote": req.getParsedHeader( "from" ).params.tag,
          "local": ""
        }
      }

      /**
      @member
      @private
      */
      this._req = req
      this._req.on( "cancel", () => this._oncanceled() )
      /**
      @member
      @private
      */
      this._res = res
    }
  }

  /*
  State functions
  Get state as a string
  According to state machine in RFC 4235, we send early if we have received a 1xx with tag
  I am going to use 100 and 180 - which should be the same.
  */

  /**
    hasmedia
    @return {bool} - true if the call has media (i.e. is established on not held).
  */
  get hasmedia() {
    if( this.state.held ) return false
    return true == this.state.established
  }

  /**
    trying
    @return {bool} - true if the call has been trying.
  */
  set trying( s ) {
    if( this.state.trying != s ) {
      this.state.trying = s
    }
  }

  /**
    trying
    @return {bool} - true if the call has been trying.
  */
  get trying() {
    return this.state.trying
  }

  /**
    ringing - if the call isn't already ringing.
    @return {bool} - true if the call has been ringing.
  */
  set ringing( s ) {
    if( this.state.ringing != s ) {
      this.state.ringing = s
    }
  }

  /**
    ringing
    @return {bool} - true if the call has been ringing.
  */
  get ringing() {
    return true == this.state.ringing
  }

  /**
    established - if the call isn't already established then set the answerat time.
    @param {bool} s - true if the call has been established.
  */
  set established( s ) {
    if( this.state.established != s ) {
      this.epochs.answerat = Math.floor( +new Date() / 1000 )
      this.state.established = s
    }
  }

  /**
    established
    @return {bool} - true if the call has been established.
  */
  get established() {
    return true == this.state.established
  }

  /**
    @summary canceled - if the call isn't already canceled then set the endat time.
    @type {boolean}
  */
  set canceled( s ) {
    if( this.state.canceled != s ) {
      this.epochs.endat = Math.floor( +new Date() / 1000 )
      this.state.canceled = s
    }
  }

  /**
    @summary is the call canceled
    @return {boolean} - true if the call has been canceled.
  */
  get canceled() {
    return true == this.state.canceled
  }

  /**
    destroyed - if the call isn't already desroyed then set the endat time.
    @param {bool} s - true if the call has been destroyed.
  */
  set destroyed( s ) {
    if( this.state.destroyed != s ) {
      this.epochs.endat = Math.floor( +new Date() / 1000 )
      this.state.destroyed = s
    }
  }

  /**
    destroyed
    @return {bool} - true if teh call has been destroyed.
  */
  get destroyed() {
    return true == this.state.destroyed
  }

  /**
    @summary the current state of the call as a string: trying|proceeding|early|confirmed|terminated
    @return {string}
  */
  get statestr() {
    if( this.state.established ) {
      return "confirmed"
    }

    if( this.state.ringing ) {
      return "early"
    }

    if( this.state.trying ) {
      return "proceeding"
    }

    if( this.state.destroyed ) {
      return "terminated"
    }

    return "trying"
  }

  /**
    duration
    @return {number} - the number of seconds between now (or endat if ended) and the time the call was started.
  */
  get duration() {
    if( 0 !== this.epochs.endat ) return parseInt( this.epochs.endat - this.epochs.startat )
    return parseInt( Math.floor( +new Date() / 1000 ) - this.epochs.startat )
  }

  /**
    Get the estrablished time.
    @return {number} - the number of seconds between now (or endat if ended) and the time the call was answered.
  */
  get billingduration() {
    if( 0 === this.epochs.answerat ) return 0
    if( 0 !== this.epochs.endat ) return parseInt( this.epochs.endat - this.epochs.answerat )
    return parseInt( Math.floor( +new Date() / 1000 ) - this.epochs.answerat )
  }

  /**
    Callback for events we pass back to inerested parties.
    @callback call.event
    @param {object} call - we pass *this back into the requester
  */

  /**
    Registers an event callback for this specific call.
    @memberof call
    @param {string} ev - The contact string for registered or other sip contact
    @param {call.event} cb
  */
  on( ev, cb ) {
    this._em.on( ev, cb )
  }

  /**
    Delink calls logically - any calls which have parent or children they are all removed.
    when the dialog is either answered (or doesn't answer for some reason).
    The promise resolves to a new call is one is generated, or undefined if not.
  */
  detach() {
    if( false !== this.parent ) {
      this.parent.children.delete( this )
    }

    for( let child of this.children ) {
      child.parent = false
    }

    this.parent = false
    this.children.clear()
  }

  /**
    @summary Creates a new SIP dialog. Returns a promise which resolves
    when the dialog is either answered (or doesn't answer for some reason).
    The promise resolves to a new call is one is generated, or undefined if not.
    @param {string} contact - The contact string for registered or other sip contact
    @param {Object} options - Options object. See default_options in index.js for more details.
    @param {string} options.auth.username - If SIP auth required username
    @param {string} options.auth.password - If SIP auth required password
    @param {object} options.headers - Object containing extra sip headers required.
    @return {Promise} - returns a promise which resolves to a new call object if a dialog has been confirmed. Otherwise resolves to undefined.
  */
  newuac( contact, options ) {

    return new Promise( async ( resolve, reject ) => {

      let newcall = false
      try {
        newcall = new call()
        newcall.type = "uac"
        newcall.parent = this
        newcall._promises.resolve.newuac = resolve
        newcall._promises.reject.newuac = reject

        this.children.add( newcall )

        newcall.newuactimer = setTimeout( () => {
          newcall.hangup( hangupcodes.NO_USER_RESPONSE )
        }, this.uactimeout )

        newcall.options = {
            headers: {
            }
          }

        newcall.options = { ...callmanager.options, ...newcall.options, ...options }

        if( undefined !== newcall.options.late && true === newcall.options.late ) {
          newcall.options.noAck = true /* this is a MUST for late negotiation */
        } else {
          newcall.channels.audio = await callmanager.rtp.channel()
          let localsdp = sdpgen.create().addcodecs( newcall.options.preferedcodecs )
          localsdp.setchannel( newcall.audio )

          /* Create our SDP */
          newcall.options.localSdp = localsdp.toString()
        }

        let dlg = await callmanager.options.srf.createUAC( contact, newcall.options, {
            cbRequest: ( err, req ) => {
              newcall._req = req
              newcall.state.trying = true

              newcall.sip = {
                "callid": req.getParsedHeader( "call-id" ),
                "tags": {
                  "local": req.getParsedHeader( "from" ).params.tag,
                  "remote": ""
                }
              }
            },
            cbProvisional: ( res ) => {
              newcall._res = res
              if( 180 === res.status ) {
                newcall._onring()
              }

              if( true === newcall.canceled ) {
                newcall.hangup()
              }
            }
          } )

          newcall._dialog = dlg
          newcall._onanswer()

      } catch ( err ) {

        if ( undefined !== err.status ) {
          let reason = hangupcodes.REQUEST_TERMINATED
          if( 486 === err.status ) {
            reason = hangupcodes.USER_BUSY
          }

          if( newcall ) {
            newcall._onhangup( "wire", reason )

            if( false !== newcall._promises.reject.newuac ) newcall._promises.reject.newuac( this )
            if( false !== newcall._timers.newuac ) clearTimeout( newcall._timers.newuac )

            newcall._timers.newuac = false
            newcall._promises.resolve.newuac = false
            newcall._promises.reject.newuac = false
          }

        } else {
          console.error( "New UAC Error: " + err )
        }
      }
    } )
  }

  /**
    Called from newuac when we receive a 180
    @private
  */
  _onring() {
    this.ringing = true
    if( false !== this.parent ) {
      this.parent.ring()
    }
  }

  /**
    Called from newuac when we are answered and we have a dialog, this - child call
    @private
  */
  _onanswer() {
    if( undefined !== this.parent ) {
      if( undefined !== this.parent.children ) {
        for( let child of this.parent.children ) {
          if( child.uuid !== this.uuid ) {
            child.hangup()
          }
        }
      }
      this.parent.children.clear()
      this.parent.children.add( this )
    }

    clearTimeout( this._timers.newuac )
    this._timers.newuac = false

    if( true === this.options.noAck ) {
      this._onlatebridge()
    } else {
      this._onearlybridge()
    }
  }

  /**
    On an early negotiation we have already sent our sdp without
    knowing what the otherside is going to offer. We now have the
    other sides SDP so we can work out the first common CODEC.
    @private
  */
  async _onearlybridge() {

    let remotesdp = sdpgen.create( this._dialog.remote.sdp )

    try {
      if( this.parent.established ) {

        this.selectedcodec = remotesdp.intersection( this.options.preferedcodecs, true )

        this.audio.target( remotesdp )
        this.audio.mix( this.parent.audio )

      } else {
        let remotecodecs = remotesdp.intersection( this.options.preferedcodecs )

        this.audio.target( remotesdp )

        consolelog( this, "Answering parent with prefered CODECs: " + remotecodecs )
        await this.parent.answer( { "preferedcodecs": remotecodecs } )

        this.audio.mix( this.parent.audio )

        this.established = true
        this.sip.tags.remote = this._dialog.sip.remoteTag

        if( false !== this._timers.newuac ) clearTimeout( this._timers.newuac )
        this._timers.newuac = false

        let r = this._promise.resolve.newuac
        this._promise.resolve.newuac = false
        this._promise.reject.newuac = false

        r( this )

        callmanager.options.em.emit( "call.answered", this )
        this._em.emit( "call.answered", this )

      }
    } catch ( err ) {
      console.error( err )
      if( false !== this._promise.reject.newuac ) this._promise.reject.newuac( this )
      if( false !== this._timers.newuac ) clearTimeout( this._timers.newuac )

      this._timers.newuac = false
      this._promise.resolve.newuac = false
      this._promise.reject.newuac = false
    }
  }

  /**
    Accept and bridge to calls with late negotiation.
    @private
  */
  _onlatebridge() {
    let remotesdp = sdpgen.create( this._dialog.sdp )

    /* We now have 2 calls, we may need to answer the parent */
    /* We have this._dialog (srf dialog object) */
    if( this.parent.established ) {
      this.selectedcodec = remotesdp.intersection( this.options.preferedcodecs, true )
      consolelog( this, "remote codec chosen: " + this.selectedcodec )

      callmanager.rtp.channel( remotesdp.select( this.selectedcodec ) )
        .then( ch => {
          this.channels.push( ch )
          this._addchannelevents( ch )

          let localsdp = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )
          if( true === this.options.rfc2833 ) {
            localsdp.addcodecs( "2833" )
            ch.rfc2833( 101 )
          }

          this._dialog.ack( localsdp.toString() )
            .then( ( dlg ) => {
              this._dialog = dlg
              this.addevents( this._dialog )
              this.audio.mix( this.parent.audio )

              this.established = true
              this.sip.tags.remote = dlg.sip.remoteTag

              if( false !== this._timers.newuac ) clearTimeout( this._timers.newuac )
              this._timers.newuac = false

              let r = this._promise.resolve.newuac
              this._promise.resolve.newuac = false
              this._promise.reject.newuac = false

              r( this )

              callmanager.options.em.emit( "call.answered", this )
              this._em.emit( "call.answered", this )
            } )
        } )
        .catch( () => {
          if( false !== this._promise.reject.newuac ) this._promise.reject.newuac( this )
          if( false !== this._timers.newuac ) clearTimeout( this._timers.newuac )

          this._timers.newuac = false
          this._promise.resolve.newuac = false
          this._promise.reject.newuac = false
          return
        } )
    } else {
      /* parent is not established */

      /* We need to add some code to allow transcoding if permitted
      i.e. 1. if both sides support the same codec, choose that codec,
      otherwise 2. is transcoding enabled then 3. choose other codec we are
      capable of transocding to. */
      let remotecodecs = remotesdp.intersection( this.options.preferedcodecs )
      consolelog( this, "remote codecs (late negotiation) chosen: " + remotecodecs )

      this.parent.answer( { "preferedcodecs": remotecodecs } )
        .then( () => {

          /*
          TODO - possible bug - what if both sides don't support the same codec
          */
          this.selectedcodec = this.parent.selectedcodec

          callmanager.rtp.channel( remotesdp.select( this.selectedcodec ) )
            .then( ch => {
              let localsdp = sdpgen.create().addcodecs( this.selectedcodec ).setchannel( ch )

              this.channels.push( ch )
              this._addchannelevents( ch )

              if( true === this.options.rfc2833 ) {
                localsdp.addcodecs( "2833" )
                ch.rfc2833( 101 )
              }

              this._dialog.ack( localsdp.toString() )
                .then( ( dlg ) => {
                  this._dialog = dlg
                  this.addevents( this._dialog )
                  this.audio.mix( this.parent.audio )

                  this.established = true
                  this.sip.tags.remote = dlg.sip.remoteTag

                  if( false !== this._timers.newuac ) clearTimeout( this._timers.newuac )
                  this._timers.newuac = false

                  let r = this._promise.resolve.newuac
                  this._promise.resolve.newuac = false
                  this._promise.reject.newuac = false

                  r( this )
                } )
            } )
        } )
        .catch( () => {
          if( false !== this._promise.reject.newuac ) this._promise.reject.newuac( this )
          if( false !== this._timers.newuac ) clearTimeout( this._timers.newuac )

          this._timers.newuac = false
          this._promise.resolve.newuac = false
          this._promise.reject.newuac = false
        } )
    }
  }

  /**
    Return the destination of the call.
    @return {object}  parsed uri
  */
  get destination() {
    if( undefined !== this.referingtouri ) {
      return parseuri( this.referingtouri )
    }
    return parseuri( this._req.msg.uri )
  }

  /**
    Sometimes we don't care who if we are the parent or child - we just want the other party
    @return {object|bool} returns call object or if none false
  */
  get other() {
    if( false !== this.parent ) {
      return this.parent
    }

    for( const child of this.children ) {
      if( child.established ) {
        return child
      }
    }

    return false
  }

  /**
    auth - returns promise.
    @return {Promise} Returns promise which resolves on success or rejects on failed auth. If not caught this framework will catch and cleanup.
  */
  auth() {
    return new Promise( ( resolve, reject ) => {

      if( undefined !== this.referingtouri ) {
        /* if we have been refered the call has been authed to proceed by the refering party */
        resolve()
        return
      }

      this._promise.resolve.auth = resolve
      this._promise.reject.auth = reject

      this._timers.auth = setTimeout( () => {
        this._promise.reject.auth()
        this._promise.resolve.auth = false
        this._promise.reject.auth = false
        this._timers.auth = false

        this.hangup( hangupcodes.NO_USER_RESPONSE )

      }, 50000 )

      let fromparts = parseuri( this._req.getParsedHeader( "From" ).uri )

      digestauth( {
        "proxy": true, /* 407 or 401 */
        "passwordLookup": ( username, realm, cb ) => {
          callmanager.options.userlookup( username, realm )
            .then( ( u ) => {
              cb( false, u.secret )
            } )
            .catch( () => {
              cb( false, false )
            } )
        },
        "realm": fromparts.host
      } )( this._req, this._res, () => {} )
    } )
  }

  /**
    Called by us we handle the auth challenge in this function
    @private
  */
  _onauth( req, res ) {

    /* are we waiting for an auth ?*/
    if( false !== this._promise.resolve.auth ) {

      this._req = req
      this._res = res

      this._req.on( "cancel", () => this._oncanceled() )

      consolelog( this, "checking auth" )

      let fromparts = parseuri( req.getParsedHeader( "From" ).uri )

      digestauth( {
        "proxy": true, /* 407 or 401 */
        "passwordLookup": ( username, realm, cb ) => {
          callmanager.options.userlookup( username, realm )
            .then( ( u ) => {
              cb( false, u.secret )
              if( undefined !== u.display ) this.entity.display = u.display
            } )
            .catch( () => {
              cb( false, false )
            } )
        },
        "realm": fromparts.host
      } )( this._req, this._res, () => {
        consolelog( this, "resolving auth" )
        if( false !== this._timers.auth ) {
          clearTimeout( this._timers.auth )
          this._timers.auth = false
        }

        this.entity.username = this._req.authorization.username
        this.entity.realm = this._req.authorization.realm
        this.entity.uri = this._req.authorization.username + "@" + this._req.authorization.realm

        callstore.set( this )

        this._promise.resolve.auth()
        this._promise.resolve.auth = false
        this._promise.reject.auth = false
        this._timers.auth = false

        callstore.getbyentity()
          .then( ( s ) => {
            callmanager.options.em.emit( "presence.dialog.out", {
              "entity": this.entity.uri,
              "username": this.entity.username,
              "realm": this.entity.realm,
              "display": this.entity.display,
              "update": this,
              "all": s
            } )
            this._em.emit( "presence.dialog.out", {
              "entity": this.entity.uri,
              "username": this.entity.username,
              "realm": this.entity.realm,
              "display": this.entity.display,
              "update": this,
              "all": s
            } )
          } )
          .catch( () => {} )
      } )
    }
  }

  /**
    Called by us to handle call cancelled
    @private
  */
  _oncanceled( req, res ) {
    consolelog( this, "client canceled" )
    this.canceled = true

    for( let child of this.children ) {
      child.hangup()
    }
  }

  /**
    Called by us to handle DTMF events. If it finds a matche it resolves the Promise created by waitforevents.
    @private
  */
  _tevent( e ) {
    this._receivedtelevents += eventdefs[ e ]

    if( undefined !== this.eventmatch ) {
      let ourmatch = this._receivedtelevents.match( this.eventmatch )
      if( null !== ourmatch ) {
        if( false !== this._promise.resolve.events ) {
          this._promise.resolve.events( ourmatch[ 0 ] )
        }
        if( false !== this._timers.events ) {
          clearTimeout( this._timers.events )
        }

        this._promise.resolve.events = false
        this._timers.events = false
      }
    }
  }

  /**
    Called by us to handle DTMF events. If it matches the supplied pattern then we in turn call the callers callback.
    @param {string} [match] - reg exp matching what is required from the user.
    @param {Int} [timeout] - time to wait before giving up.
    @return {Promise} - the promise either resolves to a string if it matches or undefined if it times out..
  */
  waitforevents( match = /[0-9A-D\*#]/, timeout = 30000 ) {

    return new Promise( ( resolve, reject ) => {

      this._timers.events = setTimeout( () => {
        if( false === this._promise.resolve.events ) {
          this._promise.resolve.events()
        }

        this._promise.resolve.events = false
        this._timers.events = false

      }, timeout )

      if( typeof match === "string" ){
        this.eventmatch = new RegExp( match )
      } else {
        this.eventmatch = match
      }

      /* All (previous) promises must be resolved */
      if( false !== this._promise.resolve.events ) {
        this._promise.resolve.events()
      }

      if( false !== this._timers.events ) {
        clearTimeout( this._timers.events )
      }

      this._promise.resolve.events = resolve
    } )
  }

  /**
    If we are not ringing - send ringing to the other end.
  */
  ring() {
    if( !this.ringing && "uas" === this.type ) {
      this.ringing = true
      this._res.send( 180, {
        headers: {
           "User-Agent": "project",
           "Supported": "replaces"
         }
      } )
    }
  }

  /**
    Shortcut to hangup with the reason busy.
  */
  busy() {
    this.hangup( hangupcodes.USER_BUSY )
  }

  /**
    Answer the call and store a channel which can be used.
    @return {Promise} Returns a promise which resolves if the call is answered, otherwise rejects the promise. This framework will catch and cleanup this call if this is rejected.
  */
  answer( options = {} ) {
    return new Promise( ( resolve, reject ) => {

      if( this.canceled ) {
        reject()
        return
      }

      if( this.established ) {
        resolve()
        return
      }

      this._promise.resolve.answer = resolve
      this._promise.reject.answer = reject

      options = { ...callmanager.options, ...this.options, ...options }

      let remotesdp = sdpgen.create( this._req.msg.body )

      /* options.preferedcodecs may have been narrowed down so we still check callmanager as well */
      this.selectedcodec = remotesdp.intersection( options.preferedcodecs, true )
      if( false === this.selectedcodec ) {
        this.selectedcodec = remotesdp.intersection( callmanager.options.preferedcodecs, true )
      }

      consolelog( this, "answer call with codec " + this.selectedcodec )

      callmanager.rtp.channel( remotesdp.select( this.selectedcodec ) )
        .then( ch => {
          consolelog( this, "channel opened" )

          this._addchannelevents( ch )

          this.channels.push( ch )
          let localsdp = ch.localsdp.addcodecs( this.selectedcodec )

          if( this.canceled ) {
            this._promise.reject.answer()

            this._promise.resolve.answer = false
            this._promise.reject.answer = false
            return
          }

          if( true === callmanager.options.rfc2833 ) {
            localsdp.addcodecs( "2833" )
            ch.rfc2833( 101 )
          }

          callmanager.options.srf.createUAS( this._req, this._res, {
            localSdp: localsdp.toString(),
            headers: {
               "User-Agent": "project",
               "Supported": "replaces"
             }
          } )
          .then( ( dialog ) => {
            this.established = true
            this._dialog = dialog
            this.sip.tags.local = dialog.sip.localTag

            this.addevents( this._dialog )
            this._promise.resolve.answer()

            this._promise.resolve.answer = false
            this._promise.reject.answer = false
          } )
        } ).catch( ( err ) => {
          this._promise.reject.answer()

          this._promise.resolve.answer = false
          this._promise.reject.answer = false
        } )
    } )
  }

  /**
    Private helper function to add events to our RTP channel.
    @param {object} channel - the rtp channel
    @private
  */
  _addchannelevents( ch ) {
    ch.on( "telephone-event", ( e ) => this._tevent( e ) )

    // If our RTP server closes on us then it will be media timout */
    ch.on( "close", ( e ) => this.hangup( hangupcodes.USER_GONE ) )
  }

  /**
    If we have been placed on hold (and it has been neotiated) then configure audio to match.
    @private
  */
  _hold() {

    consolelog( this, "Placing call on hold" )
    if( this.state.held ) return
    this.state.held = true

    this.audio.setaudiodirection( "inactive" )

    let other = this.other
    if( other ) {
      this.audio.unmix()
      other.audio.play( callmanager.options.moh )
    }
  }

  /**
    Same as _hold.
    @private
  */
  _unhold() {
    consolelog( this, "Taking call off hold" )
    if( !this.state.held ) return
    this.state.held = false

    let other = this.other
    if( other ) {
      this.audio.mix( other.audio )
    }

    this.audio.setaudiodirection( "sendrecv" )

  }

  /**
    As part of the transfer flow a subscription is implied during a transfer which we must update the transferee.
    @private
  */
  _notifyreferfail() {
    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer;id=" + this.referreq.get( "cseq" ).match( /(\d+)/ )[ 0 ],
        "Subscription-State": "terminated;reason=error",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 400 Ok\r\n"
    }

    return this._dialog.request( opts )
  }

  /**
    As part of the transfer flow a subscription is implied during a transfer which we must update the transferee.
    @private
  */
  _notifyrefercomplete() {
    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer;id=" + this.referreq.get( "cseq" ).match( /(\d+)/ )[ 0 ],
        "Subscription-State": "terminated;reason=complete",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 200 Ok\r\n"
    }

    return this._dialog.request( opts )
  }

  /**
    As part of the transfer flow a subscription is implied during a transfer which we must update the transferee.
    @private
  */
  _notifyreferstart() {
    let opts = {
      "method": "NOTIFY",
      "headers": {
        "Event": "refer;id=" + this.referreq.get( "cseq" ).match( /(\d+)/ )[ 0 ],
        "Subscription-State": "active;expires=60",
        "Content-Type": "message/sipfrag;version=2.0"
      },
      "body": "SIP/2.0 100 Trying\r\n"
    }

    return this._dialog.request( opts )
  }

  /**
    Send out modified SDP to get the audio to the new location.
    @private
  */
  _modifyforxfer() {
    return this._dialog.modify( this.audio.localsdp.toString() )
  }

  /**
    Add events for the drachtio dialog object that this object requires.
    @private
  */
  addevents( dialog ) {

    /* Drachtio doesn't appear to have finished SE support, i.e. it sends
    a regular INVITE when we set the Supported: timer and Session-Expires headers
    but it doesn't appear to indicate to us when it does fail. It most cases our
    RTP stall timer will kick in first, but if a call is placed on hold followed
    by AWOL... */
    this.seintervaltimer = setInterval( () => {
      let opts = {
        "method": "INVITE",
        "body": this.audio.localsdp.toString()
      }

      dialog.request( opts )
        .then( ( res ) => {
          if( 200 != res.msg.status ) {
            this.hangup( hangupcodes.USER_GONE )
          }
        } )
        .catch( () => {
          this.hangup( hangupcodes.USER_GONE )
        } )
    }, callmanager.options.seexpire )

    dialog.on( "destroy", ( req ) => {
      if( this.destroyed ) return
      this._onhangup( "wire" )
    } )

    dialog.on( "modify", ( req, res ) => {
      //  The application must respond, using the res parameter provided.
      if( "INVITE" === req.msg.method ) {

        let sdp = sdpgen.create( req.msg.body )
        let media = sdp.getmedia()

        if( ( "inactive" === media.direction || "0.0.0.0" === sdp.sdp.connection.ip ) && !this.state.held ) {
          this._hold()
          res.send( 200, {
            "headers": {
              "Subject" : "Call on hold",
              "User-Agent": "project",
              "Allow": "INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY",
              "Supported": "replaces"
            },
            "body": this.audio.localsdp.toString()
          } )
        } else if( "inactive" !== media.direction && "0.0.0.0" !== sdp.sdp.connection.ip && this.state.held ) {
          this._unhold()
          res.send( 200, {
            "headers": {
              "Subject" : "Call off hold",
              "User-Agent": "project"
            },
            "body": this.audio.localsdp.toString()
          } )
        } else {
          /* Unknown - but respond to keep the call going */
          res.send( 200, {
            "headers": {
              "Subject" : "Ok",
              "User-Agent": "project"
            },
            "body": this.audio.localsdp.toString()
          } )
        }
      }
    } )

    dialog.on( "refer", ( req, res ) => {
      /*
        We only support the xfer of 2 legged calls. The xfered call will pick up
        the auth from teh transferee. For example, inbound anonymous call, gets handled
        by user 1. User 1 then refers - to internal extension, so this can has now been
        authed by user 1 - so has access to internal extenions.
      */

      /* First, auth the request */
      let fromparts = parseuri( req.getParsedHeader( "From" ).uri )
      digestauth( {
        "proxy": true, /* 407 or 401 */
        "passwordLookup": ( username, realm, cb ) => {
          callmanager.options.userlookup( username, realm )
            .then( ( u ) => {
              cb( false, u.secret )
            } )
            .catch( () => {
              cb( false, false )
            } )
        },
        "realm": fromparts.host
      } )( this._req, this._res, () => {

        if( !req.has( "refer-to" ) ) {
          res.send( 400, "Bad request - no refer-to" )
          return
        }

        let referto = req.getParsedHeader( "refer-to" )
        let parsedrefuri = parseuri( referto.uri )

        if( undefined === parsedrefuri.user ) {
          res.send( 400, "Bad request - no refer-to user" )
          return
        }

        if( undefined === parsedrefuri.host ) {
          res.send( 400, "Bad request - no refer-to host" )
          return
        }

        /*
        Example refer to fields
        Refer-To: sip:alice@atlanta.example.com

        Refer-To: <sip:bob@biloxi.example.net?Accept-Contact=sip:bobsdesk.
               biloxi.example.net&Call-ID%3D55432%40alicepc.atlanta.example.com>

        Refer-To: <sip:dave@denver.example.org?Replaces=12345%40192.168.118.3%3B
                  to-tag%3D12345%3Bfrom-tag%3D5FFE-3994>

        Refer-To: <sip:carol@cleveland.example.org;method=SUBSCRIBE>
        */

        this.referreq = req
        this.referres = res


        /* getParsedHeader doesn't appear to parse tags in uri params */
        let replacesuri = decodeURIComponent( referto.uri )
        let replaces = replacesuri.match( /replaces=(.*?)(;|$)/i )

        if( null !== replaces ) {
          /* Attended xfer */
          consolelog( this, "Attended xfer - swapping channels" )

          let totag = replacesuri.match( /to-tag=(.*?)(;|$)/i )
          let fromtag = replacesuri.match( /from-tag=(.*?)(;|$)/i )

          if( replaces.length < 3 || totag.length < 3 || fromtag.length < 3 ) {
            consolelog( this, "Bad replaces string" )
            res.send( 400, "Bad call reference for replaces" )
            return
          }

          let searchfor = { "callid": replaces[ 1 ], "tags": { "local": totag[ 1 ], "remote": fromtag[ 1 ] } }
          callstore.getbycallid( searchfor )
            .then( ( replacesother ) => {

              let ourother = this.other
              let replacesotherother = replacesother.other
              if( false === replacesotherother ) {
                throw "Can't attened xfer 1 legged calls"
              }
              this.detach()

              /* Swap channels and update */
              let replacesotherotheraudio = replacesotherother.audio
              replacesotherother.audio = this.audio
              replacesotherother.detach()

              replacesotherother.audio.localsdp
                .clearcodecs()
                .addcodecs( replacesotherother.selectedcodec )
                .select( replacesotherother.selectedcodec )
                .setaudiodirection( "sendrecv" )

              if( true === callmanager.options.rfc2833 ) {
                replacesotherother.audio.localsdp.addcodecs( "2833" )
              }

              /* this one will be hung up soon anyway */
              this.audio = replacesotherotheraudio

              /* Link logically */

              if( false !== ourother ) {
                /* 2 legged */
                replacesotherother.children.add( ourother )
                ourother.parent = replacesotherother
                replacesotherotheraudio.audio.mix( ourother.audio )
              }

              res.send( 202, "Refering", {}, () => {
                  this._notifyreferstart()
                    .then( () => {

                      /* modify ports and renegotiate codecs */
                      replacesotherother._modifyforxfer()
                        .then( ( o ) => {

                          let remotesdp = sdpgen.create( o )
                          consolelog( this, "remote codec chosen (modify): " + replacesotherother.selectedcodec )
                          replacesotherother.audio.target( remotesdp.select( replacesotherother.selectedcodec ) )

                          /* Now inform our RTP server also - we might need to wait untl the target has completed so need a notify mechanism */
                          replacesotherother.audio.setaudiodirection( "sendrecv" )

                          this._notifyrefercomplete()

                          this.hangup_cause = hangupcodes.ATTENDED_TRANSFER
                          replacesother.hangup( hangupcodes.ATTENDED_TRANSFER )
                        } )
                    } )
                    .catch( () => {
                      this._notifyreferfail()
                    } )
                  } )
          } )
            .catch( ( e ) => {
              consolelog( this, "Failed to find replaces call for xfer" )
              consolelog( this, e )
              res.send( 400, e )
              return
            } )

        } else {
          /* This is our blind xfer */
          consolelog( this, "Blind xfer - sending back to oncall" )
          let othercall = this.other

          if( false === othercall ) {
            res.send( 400, "We have no-one to refer" )
            return
          }

          this.detach()
          res.send( 202 )
          this._notifyreferstart()

          othercall.referingtouri = referto.uri
          callmanager.options.em.emit( "call", othercall )
          this._em.emit( "call", othercall )
          this._notifyrefercomplete()

          /* As part of the call flow the client will send us a hangup  next */
          this.hangup_cause = hangupcodes.BLIND_TRANSFER
        }
      } )
    } )
  }

  /**
    When our dialog has confirmed we have hung up
    @param {string} [us] - "us"|"wire"
    @param {object} reason - one of the reasons from the hangupcodes enum
    @private
  */
  _onhangup( src = "us", reason ) {

    if( this.destroyed ) {
      this._cleanup()
      return
    }

    if( undefined !== reason ) {
      this.hangup_cause = reason
    }

    if( undefined === this.hangup_cause ) {
      this.hangup_cause = hangupcodes.NORMAL_CLEARING
    }

    if( "wire" !== src && !this.established ) {
      this.hangup_cause = hangupcodes.ORIGINATOR_CANCEL
    }

    consolelog( this, "on hangup from " + src + " with reason " + this.hangup_cause.reason + ", SIP: " + this.hangup_cause.sip )

    let wasestablished = this.established

    this.destroyed = true

    if( undefined !== this._timers.newuac ) clearTimeout( this._timers.newuac )
    if( undefined !== this._timers.auth ) {
      clearTimeout( this._timers.auth )
      this._timers.auth = false
    }

    this.channels.forEach( ( ch ) => ch.destroy().catch( () => { consolelog( this, "Channel already closed - perhaps RTP stalled?" ) } ) )
    this.channels = []

    callstore.delete( this )

    if( false !== this.parent && true === wasestablished ) {
      this.parent.hangup( this.hangup_cause )
    }

    for( let child of this.children ) {
      child.hangup( this.hangup_cause )
    }

    callmanager.options.em.emit( "call.destroyed", this )
    this._em.emit( "call.destroyed", this )

    this._cleanup()
  }

  /**
    Use this as our destructor. This may get called more than once depending on what is going on
    @private
  */
  _cleanup() {
    /* Clean up promises (ensure they are resolved) and clear any timers */
    if( false !== this._promise.reject.auth ) {
      this._promise.reject.auth( this )
    }

    if( false !== this._timers.events ) {
      clearTimeout( this._timers.events )
      this._timers.events = false
    }

    if( false !== this._promise.resolve.events ) {
      this._promise.resolve.events( this )
      this._promise.resolve.events = false
    }

    if( false !== this._timers.newuac ) {
      clearTimeout( this._timers.newuac )
      this._timers.newuac = false
    }

    if( false !== this._promise.reject.newuac ) {
      this._promise.reject.newuac( this )
      this._promise.reject.newuac = false
    }

    if( false !== this._promise.reject.answer ) {
      this._promise.reject.answer( this )
      this._promise.reject.answer = false
    }

    if( false !== this._promise.resolve.hangup ) {
      this._promise.resolve.hangup( this )
      this._promise.resolve.hangup = false
    }

    if( undefined !== this.seintervaltimer ) {
      clearInterval( this.seintervaltimer )
    }
  }

  /**
    Hangup the call with reason.
    @param {object} reason - one of the reasons from the hangupcodes enum
  */
  hangup( reason ) {

    if( this.destroyed ) return

    if( undefined === reason ) {
      reason = hangupcodes.NORMAL_CLEARING
    } else if ( typeof reason === "object" ) {
      if( undefined !== reason.hangup_cause ) {
        reason = reason.hangup_cause
      }
    }

    this.hangup_cause = reason

    consolelog( this, "hanging up call by request with the reason " + reason.reason + ", SIP: " + reason.sip )

    if( this.established ) {
      try {
        this._dialog.destroy()
      } catch( e ) { console.error( "Unknown error trying to destroy" ) }

    } else if( "uac" === this.type ) {
      try {
        this._req.cancel()
      } catch( e ) { console.error( "Unknown error trying to cancel" ) }

      this.canceled = true

    } else {
      try {
        this._res.send( reason.sip )
      } catch( e ) { console.error( "Unknown error trying to send" ) }
    }

    this._onhangup( "us", reason )
  }

  waitforhangup() {
    return new Promise( ( resolve, reject ) => {
      this._promise.resolve.hangup = resolve
      this._promise.reject.hangup = reject

      if( this.destroyed ) {
        this._promise.resolve.hangup()
        this._promise.resolve.hangup = false
        this._promise.reject.hangup = false
      }
    } )
  }
}

module.exports.call = call
module.exports.hangupcodes = hangupcodes
module.exports.setconsolelog = function( c ) { consolelog = c }
module.exports.setcallmanager = function( cm ) { callmanager = cm }
