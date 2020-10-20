import { Signal } from './signal';
import { LocalStream, makeRemote, RemoteStream } from './stream';
import PeerConnection from './peerconnection';

export default class Client {
  private api: RTCDataChannel;
  pc: RTCPeerConnection;
  private signal: Signal;
  private candidates: RTCIceCandidateInit[];

  ontrack?: (track: MediaStreamTrack, stream: RemoteStream) => void;

  remotes: Map<string, RemoteStream>;

  constructor(
    sid: string,
    signal: Signal,
    config: RTCConfiguration = {
      iceServers: [{ urls: 'stun:stun.stunprotocol.org:3478' }],
    },
  ) {
    this.candidates = [];
    this.remotes = new Map();

    this.signal = signal;
    this.pc = new PeerConnection(config);
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        signal.trickle(candidate);
      }
    };
    this.api = this.pc.createDataChannel('ion-sfu');

    this.pc.ontrack = (ev: RTCTrackEvent) => {
      const stream = ev.streams[0];

      let remote = this.remotes.get(stream.id);
      if (!remote) {
        remote = makeRemote(stream, this.api);
        this.remotes.set(stream.id, remote);
      }

      if (this.ontrack) {
        this.ontrack(ev.track, remote);
      }
    };

    signal.onnegotiate = this.negotiate.bind(this);
    signal.ontrickle = this.trickle.bind(this);
    signal.onready = () => this.join(sid);
  }

  getStats(selector?: MediaStreamTrack) {
    return this.pc.getStats(selector);
  }

  publish(stream: LocalStream) {
    stream.publish(this.pc);
  }

  close() {
    this.signal.close();
  }

  private async join(sid: string) {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    const answer = await this.signal.join(sid, offer);

    await this.pc.setRemoteDescription(answer);
    this.candidates.forEach((c) => this.pc.addIceCandidate(c));
    this.pc.onnegotiationneeded = this.onNegotiationNeeded.bind(this);
  }

  private trickle(candidate: RTCIceCandidateInit) {
    if (this.pc.remoteDescription) {
      this.pc.addIceCandidate(candidate);
    } else {
      this.candidates.push(candidate);
    }
  }

  private async negotiate(jsep: RTCSessionDescriptionInit) {
    if (jsep.type === 'offer') {
      await this.pc.setRemoteDescription(jsep);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.signal.answer(answer);
    } else if (jsep.type === 'answer') {
      this.pc.setRemoteDescription(jsep);
    }
  }

  private async onNegotiationNeeded() {
    const offer = await this.pc!.createOffer();
    await this.pc.setLocalDescription(offer);
    const answer = await this.signal.offer(offer);
    this.pc.setRemoteDescription(answer);
  }
}
