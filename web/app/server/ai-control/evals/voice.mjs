// Eval cases for voice: the session a voice part opens, checked as both providers take it
// (fixtures/voice.mjs, sessionOnly: no realtime model is asked, so a case has no answer to grade,
// only the session it renders).
const SESSION = ['renders', 'noPlaceholders', 'parses']

export default {
  'voice.chat': [
    { name: 'A slate, open mic: instructions, tool and opening reach both providers', sample: 'chat-open', assert: SESSION },
    { name: 'A slate, push to talk with a chosen voice: the voice and the mode reach both providers', sample: 'chat-ptt-voice', assert: SESSION },
    { name: 'A slate, carrying on: what was said goes in as data and the agent waits', sample: 'chat-resumed', assert: SESSION },
  ],
  'voice.interview': [
    { name: 'The interview, open mic: instructions, tool and opening reach both providers', sample: 'interview-open', assert: SESSION },
    { name: 'The interview, carrying on: what was said goes in as data and the agent waits', sample: 'interview-resumed', assert: SESSION },
  ],
  voice: [
    { name: 'The tool on a slate', sample: 'chat-open', assert: SESSION },
    { name: 'The tool in the interview', sample: 'interview-open', assert: SESSION },
    { name: 'Carrying on after a move, on a slate', sample: 'chat-resumed', assert: SESSION },
    { name: 'Carrying on after a move, in the interview', sample: 'interview-resumed', assert: SESSION },
  ],
}
