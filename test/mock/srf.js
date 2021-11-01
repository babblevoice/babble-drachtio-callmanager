

/*
Mock req object
*/
class req {
  constructor() {
    this.parsedheaders = {}
    this.method = "INVITE"

    this.source_address = "127.0.0.1"
    this.source_port = 5060
    this.protocol = "udp"
    this.entity = {
      "uri": "1000@domain"
    }

    this.events = {}

    this.msg = {
      "body": `v=0
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
a=sendrecv`.replace(/(\r\n|\n|\r)/gm, "\r\n")
    }
  }

  getParsedHeader( header ) {
    return this.parsedheaders[ header ]
  }

  setparsedheader( header, value ) {
    this.parsedheaders[ header ] = value
  }

  cancel() {
    if( this.events.cancel ) {
      this.events.cancel()
    }
  }

  on( event, cb ) {
    this.events[ event ] = cb
  }
}


module.exports.req = req
