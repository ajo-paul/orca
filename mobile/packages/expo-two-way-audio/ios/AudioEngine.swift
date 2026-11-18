import AVFoundation
import Foundation

class AudioEngine {
    private var avAudioEngine = AVAudioEngine()
    private var playerNode = AVAudioPlayerNode()
    private var engineConfigChangeObserver: Any?
    private var sessionInterruptionObserver: Any?
    private var mediaServicesResetObserver: Any?
    private var routeChangeObserver: Any?

    public private(set) var voiceIOFormat: AVAudioFormat
    private let playback24kFormat: AVAudioFormat
    public private(set) var isRecording = false
    private var interruptionIntent = RecordingInterruptionIntent()
    private var isTornDown = false
    private var isHoldAudioQuiet = false
    private var wasRecordingBeforeHold = false
    private let playbackLock = NSLock()
    private var queuedBufferCount = 0
    private var playbackGeneration: UInt64 = 0

    public var onMicDataCallback: ((Data) -> Void)?
    public var onInputVolumeCallback: ((Float) -> Void)?
    public var onAudioInterruptionCallback: ((String) -> Void)?
    public var onPlaybackStateChangeCallback: ((Bool, Float) -> Void)?

    private var inputBuffer = [Float](repeating: 0, count: 2048)
    private var inputBufferIndex = 0

    enum AudioEngineError: Error {
        case audioFormatError
    }

    init() throws {
        avAudioEngine.attach(playerNode)

        guard let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1),
              let format24k = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false) else {
            throw AudioEngineError.audioFormatError
        }
        voiceIOFormat = format
        playback24kFormat = format24k
        print("Voice IO format: \(String(describing: voiceIOFormat))")

        engineConfigChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: avAudioEngine,
            queue: .main) { [weak self] _ in
                self?.checkEngineIsRunning()
            }
        sessionInterruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main) { [weak self] notification in
                self?.handleAudioSessionInterruption(notification)
            }
        mediaServicesResetObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main) { [weak self] _ in
                self?.handleMediaServicesWereReset()
            }
        routeChangeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main) { [weak self] _ in
                guard let self, !self.isHoldAudioQuiet else { return }
                self.checkEngineIsRunning()
            }

        self.setupAudioSession()
        do {
            try self.setup()
        } catch {
            // Hand the session back so a failed initialize leaves no other app's audio ducked.
            tearDown()
            throw error
        }
        self.start()
    }

    deinit {
        if let observer = engineConfigChangeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = sessionInterruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = mediaServicesResetObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = routeChangeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    func setupAudioSession() {
        let session = AVAudioSession.sharedInstance()

        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
        } catch {
            print("Could not set the audio category: \(error.localizedDescription)")
        }

        // iOS mutes haptics while input runs by default; dictation taps the user on start and stop.
        do {
            try session.setAllowHapticsAndSystemSoundsDuringRecording(true)
        } catch {
            print("Could not allow haptics during recording: \(error.localizedDescription)")
        }

        do {
            try session.setPreferredSampleRate(voiceIOFormat.sampleRate)
        } catch {
            print("Could not set the preferred sample rate: \(error.localizedDescription)")
        }

        do {
            try session.setActive(true)
        } catch {
            print("Could not set the audio session as active")
        }
    }

    func setup() throws {
        let input = avAudioEngine.inputNode
        // Throw rather than return: an engine with no mic tap would report recording and capture nothing.
        try input.setVoiceProcessingEnabled(true)

        avAudioEngine.inputNode.isVoiceProcessingInputMuted = !isRecording

        // Voice processing runs input and output as one unit; connect 24kHz playerNode -> mainMixer -> outputNode so VoiceProcessingIO uses it as AEC reference.
        avAudioEngine.connect(playerNode, to: avAudioEngine.mainMixerNode, format: playback24kFormat)
        avAudioEngine.connect(avAudioEngine.mainMixerNode, to: avAudioEngine.outputNode, format: voiceIOFormat)

        input.installTap(onBus: 0, bufferSize: 2048, format: voiceIOFormat) { [weak self] buffer, when in
            if self?.isRecording == true {
                self?.processMicrophoneBuffer(buffer)
                self?.updateInputVolume()
            }
        }

        avAudioEngine.prepare()
    }

    func processMicrophoneBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else {
            print("Error: Could not access channel data")
            return
        }

        let frameCount = Int(buffer.frameLength)
        var int16Samples = [Int16](repeating: 0, count: frameCount)

        for i in 0..<frameCount {
            let floatSample = max(-1.0, min(1.0, channelData[i]))
            int16Samples[i] = Int16(floatSample * Float(Int16.max))

            inputBuffer[inputBufferIndex] = floatSample
            inputBufferIndex = (inputBufferIndex + 1) % inputBuffer.count
        }

        let data = Data(bytes: int16Samples, count: frameCount * MemoryLayout<Int16>.size)

        onMicDataCallback?(data)
    }

    func start() {
        guard !isTornDown else { return }
        do {
            try avAudioEngine.start()
        } catch {
            print("Could not start audio engine: \(error)")
        }
    }

    func bypassVoiceProcessing(_ bypass: Bool) {
        let input = avAudioEngine.inputNode
        input.isVoiceProcessingBypassed = bypass
    }

    func playPcm24k(_ base64Data: String) {
        guard !isTornDown, !isHoldAudioQuiet else { return }
        guard let pcmData = Data(base64Encoded: base64Data), pcmData.count >= 2 else {
            return
        }
        let frameCount = UInt32(pcmData.count / 2)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: playback24kFormat, frameCapacity: frameCount),
              let destPtr = buffer.floatChannelData?[0] else {
            return
        }
        buffer.frameLength = frameCount

        var sumSquares: Float = 0
        pcmData.withUnsafeBytes { (rawBufferPointer: UnsafeRawBufferPointer) in
            guard let basePtr = rawBufferPointer.baseAddress else { return }
            let int16Ptr = basePtr.assumingMemoryBound(to: Int16.self)
            for i in 0..<Int(frameCount) {
                let sample = Float(Int16(littleEndian: int16Ptr[i])) / 32768.0
                let clamped = max(-1.0, min(1.0, sample))
                destPtr[i] = clamped
                sumSquares += clamped * clamped
            }
        }
        let rms = frameCount > 0 ? sqrt(sumSquares / Float(frameCount)) : 0

        checkEngineIsRunning()

        playbackLock.lock()
        let generation = playbackGeneration
        queuedBufferCount += 1
        playbackLock.unlock()

        onPlaybackStateChangeCallback?(true, rms)

        playerNode.scheduleBuffer(buffer) { [weak self] in
            self?.handlePlaybackBufferCompleted(generation: generation)
        }
        if !playerNode.isPlaying {
            playerNode.play()
        }
    }

    private func handlePlaybackBufferCompleted(generation: UInt64) {
        playbackLock.lock()
        let shouldEmitStopped: Bool
        if generation == playbackGeneration && queuedBufferCount > 0 {
            queuedBufferCount -= 1
            shouldEmitStopped = (queuedBufferCount == 0)
        } else {
            shouldEmitStopped = false
        }
        playbackLock.unlock()

        if shouldEmitStopped {
            onPlaybackStateChangeCallback?(false, 0)
        }
    }

    func interruptPlayback() {
        playbackLock.lock()
        playbackGeneration &+= 1
        queuedBufferCount = 0
        playbackLock.unlock()

        playerNode.stop()
        playerNode.reset()
        onPlaybackStateChangeCallback?(false, 0)
    }

    func setSpeakerOutput(_ enabled: Bool) {
        let session = AVAudioSession.sharedInstance()
        let externalPortTypes: Set<AVAudioSession.Port> = [
            .bluetoothHFP,
            .bluetoothA2DP,
            .bluetoothLE,
            .headphones,
            .carAudio
        ]
        let hasExternalRoute = session.currentRoute.outputs.contains { externalPortTypes.contains($0.portType) }
        do {
            if enabled && !hasExternalRoute {
                try session.overrideOutputAudioPort(.speaker)
            } else {
                try session.overrideOutputAudioPort(.none)
            }
        } catch {
            print("Could not override output audio port: \(error.localizedDescription)")
        }
    }

    func setHoldAudioMode(_ onHoldQuiet: Bool) {
        guard !isTornDown, onHoldQuiet != isHoldAudioQuiet else { return }
        isHoldAudioQuiet = onHoldQuiet
        if onHoldQuiet {
            wasRecordingBeforeHold = isRecording
            interruptPlayback()
            _ = toggleRecording(false)
            avAudioEngine.pause()
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                print("Could not deactivate audio session for hold: \(error.localizedDescription)")
            }
        } else {
            setupAudioSession()
            checkEngineIsRunning()
            if wasRecordingBeforeHold {
                _ = toggleRecording(true)
            }
            wasRecordingBeforeHold = false
        }
    }

    func toggleRecording(_ val: Bool, preservingInterruptionIntent: Bool = false) -> Bool {
        guard !val || !isTornDown else { return false }
        if !preservingInterruptionIntent {
            // An explicit stop also cancels a resume queued before JavaScript cancelled dictation.
            interruptionIntent.cancel()
        }
        if val {
            do {
                // System keyboard dictation can leave an existing engine's session inactive.
                try AVAudioSession.sharedInstance().setActive(true)
                if !avAudioEngine.isRunning {
                    try avAudioEngine.start()
                }
            } catch {
                isRecording = false
                avAudioEngine.inputNode.isVoiceProcessingInputMuted = true
                print("Could not activate microphone recording: \(error)")
                return false
            }
        }
        isRecording = val
        if !isRecording {
            avAudioEngine.inputNode.isVoiceProcessingInputMuted = true
            inputBuffer = [Float](repeating: 0, count: 2048)
            updateInputVolume()
        } else {
            avAudioEngine.inputNode.isVoiceProcessingInputMuted = false
        }
        print("Recording \(isRecording ? "started" : "stopped")")

        return isRecording
    }

    func stopRecording(clearInterruptionResume: Bool = true){
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Could not set the audio session to inactive: \(error)")
        }
        toggleRecording(false, preservingInterruptionIntent: !clearInterruptionResume)
    }

    func tearDown() {
        guard !isTornDown else { return }
        isTornDown = true
        interruptPlayback()
        // Stop I/O first; deactivating a session with running I/O returns a busy error.
        avAudioEngine.stop()
        stopRecording()
    }

    private func checkEngineIsRunning() {
        guard !isTornDown else { return }
        if !avAudioEngine.isRunning {
            start()
        }
    }

    private func handleAudioSessionInterruption(_ notification: Notification) {
        guard !isTornDown else { return }
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        switch type {
        case .began:
            interruptionIntent.began(wasRecording: isRecording)
            self.stopRecording(clearInterruptionResume: false)
            onAudioInterruptionCallback?("began")
        case .ended:
            let rawOptions = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume)
            switch interruptionIntent.ended(shouldResume: shouldResume, isRecording: isRecording) {
            case .resume:
                let resumed = toggleRecording(true)
                onAudioInterruptionCallback?(resumed ? "ended" : "blocked")
            case .blocked:
                onAudioInterruptionCallback?("blocked")
            case .none:
                break // A newer explicit start already owns the microphone.
            }
        @unknown default:
            stopRecording()
            onAudioInterruptionCallback?("blocked")
        }
    }

    private func handleMediaServicesWereReset() {
        guard !isTornDown else { return }
        self.avAudioEngine.stop()
        do {
            try self.setup()
        } catch {
            print("Could not rebuild the audio engine: \(error)")
            tearDown()
            onAudioInterruptionCallback?("blocked")
            return
        }
        self.start()
    }

    private func updateInputVolume() {
        let volume = calculateRMSLevel(from: inputBuffer)
        onInputVolumeCallback?(volume)
    }

    private func calculateRMSLevel(from buffer: [Float]) -> Float {
        let epsilon: Float = 1e-5 // To avoid log(0)
        let rmsValue = sqrt(buffer.reduce(0) { $0 + $1 * $1 } / Float(buffer.count))

        let dbValue = 20 * log10(max(rmsValue, epsilon))

        // Normalize the assumed audible range [-80, 0] dB.
        let minDb: Float = -80.0
        let normalizedValue = max(0.0, min(1.0, (dbValue - minDb) / abs(minDb)))

        let expFactor: Float = 2.0
        let adjustedValue = pow(normalizedValue, expFactor)

        return adjustedValue
    }
}
