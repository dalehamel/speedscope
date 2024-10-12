// https://github.com/tmm1/stackprof

import {Profile, FrameInfo, StackListProfileBuilder} from '../lib/profile'
import {RawValueFormatter, TimeFormatter} from '../lib/value-formatters'

interface StackprofFrame {
  name?: string
  file?: string
  line?: number
}

export interface StackprofProfile {
  frames: {[number: string]: StackprofFrame}
  mode: string
  raw: number[]
  raw_lines: number[]
  raw_timestamp_deltas: number[]
  samples: number
  interval: number
}

export function importFromStackprof(stackprofProfile: StackprofProfile): Profile {
  const {frames, mode, raw, raw_lines, raw_timestamp_deltas, interval} = stackprofProfile
  const profile = new StackListProfileBuilder()
  profile.setValueFormatter(new TimeFormatter('microseconds')) // default to time format unless we're in object mode

  let sampleIndex = 0

  let prevStack: FrameInfo[] = []

  for (let i = 0; i < raw.length; ) {
    const stackHeight = raw[i++]

    let stack: FrameInfo[] = []
    for (let j = 0; j < stackHeight; j++) {
      const id = raw[i++]
      const lineNo = raw_lines ? raw_lines[i - 1] : frames[id].line
      let frameName = frames[id].name
      if (frameName == null) {
        frameName = '(unknown)'
      }
      const frame = {
        key: bitShiftXorNumbers(id, lineNo ? lineNo : 0),
        ...frames[id],
        line: lineNo,
        name: frameName,
      }
      stack.push(frame)
    }
    if (stack.length === 1 && stack[0].name === '(garbage collection)') {
      stack = prevStack.concat(stack)
    }
    const nSamples = raw[i++]

    switch (mode) {
      case 'object':
        profile.appendSampleWithWeight(stack, nSamples)
        profile.setValueFormatter(new RawValueFormatter())
        break
      case 'cpu':
        profile.appendSampleWithWeight(stack, nSamples * interval)
        break
      default:
        let sampleDuration = 0
        for (let j = 0; j < nSamples; j++) {
          sampleDuration += raw_timestamp_deltas[sampleIndex++]
        }
        profile.appendSampleWithWeight(stack, sampleDuration)
    }

    prevStack = stack
  }

  return profile.build()
}

/*
This is not really generalizable, just meant to be a relatively fast way to
combine the two numbers while not losing precision. We can't use the same
representation that stackprof uses of just bit shifting, so we "hash" them
by bit shifting and Xoring them.
*/
function bitShiftXorNumbers(num1: number, num2: number): number {
  const prime1 = 31 // A small prime number to "seed" the "hash"
  const prime2 = 37 // Another small prime number

  // Use a combination of multiplication and addition to reduce collision risk
  const hash1 = (num1 * prime1) ^ (num1 >> 16) // XOR with a right shift of num1
  const hash2 = (num2 * prime2) ^ (num2 << 8) // XOR with a left shift of num2

  // Shift hash1 left to make room for hash2 and combine them
  return (hash1 << 16) ^ hash2
}
