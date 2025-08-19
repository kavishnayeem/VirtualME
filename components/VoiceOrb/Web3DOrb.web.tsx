import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';

type Props = { intensity?: number };

// ========= CONFIG: point this to your server =========
const BACKEND_URL = 'https://virtual-me-voice-agent.vercel.app'; // <-- change to your LAN IP or tunnel URL

const ORB_RADIUS = 7; // Keep orb radius constant

const Web3DOrb: React.FC<Props> = ({ intensity = 0.6 }) => {
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [currentVolume, setCurrentVolume] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<string>('Tap the orb to start/stop.');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // New: state for output audio volume (for orb vibration)
  const [outputVolume, setOutputVolume] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const ballRef = useRef<THREE.Mesh | null>(null);
  const originalPositionsRef = useRef<Float32Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // For recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // For output audio
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputDataArrayRef = useRef<Uint8Array | null>(null);
  const outputAnimationFrameRef = useRef<number | null>(null);

  // Track if we've ever created a MediaElementAudioSourceNode for this audio element
  const audioElementSourceCreatedRef = useRef<boolean>(false);

  const noise = useMemo(() => createNoise3D(), []);

  // Handle mic and volume
  useEffect(() => {
    let animationId: number | null = null;
    let audioStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;

    if (!isListening) {
      setCurrentVolume(0);
      return;
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStream = stream;
        audioStreamRef.current = stream;
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateAmplitude = () => {
          if (analyser && dataArray) {
            analyser.getByteTimeDomainData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const v = (dataArray[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / dataArray.length);
            setCurrentVolume(Math.min(1, rms * 2.5));
          }
          animationId = requestAnimationFrame(updateAmplitude);
        };
        updateAmplitude();
      } catch {
        setMicError('Microphone access denied or unavailable.');
        setCurrentVolume(0);
      }
    })();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
      if (audioContext) audioContext.close();
      audioStreamRef.current = null;
    };
  }, [isListening]);

  // Orb rendering
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(0, 0, 20);
    camera.lookAt(scene.position);

    scene.add(camera);
    sceneRef.current = scene;
    groupRef.current = group;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    rendererRef.current = renderer;

    const icosahedronGeometry = new THREE.IcosahedronGeometry(ORB_RADIUS, 11);
    const lambertMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      wireframe: true,
    });

    const ball = new THREE.Mesh(icosahedronGeometry, lambertMaterial);
    ball.position.set(0, 0, 0);
    ballRef.current = ball;
    originalPositionsRef.current = (ball.geometry.attributes.position.array as Float32Array).slice();
    group.add(ball);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const spot = new THREE.SpotLight(0xffffff, 0.9);
    spot.position.set(-10, 40, 20);
    spot.lookAt(ball.position);
    spot.castShadow = true;
    scene.add(spot);

    scene.add(group);

    containerRef.current.appendChild(renderer.domElement);
    const size = Math.min(containerRef.current.clientWidth, 500);
    renderer.setSize(size, size);

    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current || !containerRef.current) return;
      const s = Math.min(containerRef.current.clientWidth, 500);
      cameraRef.current.aspect = 1;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(s, s);
    };

    const renderLoop = () => {
      if (!groupRef.current || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
      groupRef.current.rotation.y += 0.003;
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      animationFrameRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        // @ts-ignore
        rendererRef.current.forceContextLoss?.();
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  // Orb morphing
  useEffect(() => {
    // If orb is "speaking", use outputVolume, else use mic input
    const vibrate = isSpeaking && outputVolume > 0.01;
    const morphVolume = vibrate ? outputVolume : (isListening ? currentVolume : 0);

    if (ballRef.current && originalPositionsRef.current) {
      updateBallMorph(
        ballRef.current,
        morphVolume,
        intensity,
        noise,
        originalPositionsRef.current,
        isListening || vibrate
      );
    }
  }, [currentVolume, isListening, intensity, noise, outputVolume, isSpeaking]);

  // Orb morph function
  const updateBallMorph = (
    mesh: THREE.Mesh,
    volume: number,
    intens: number,
    noise3D: ReturnType<typeof createNoise3D>,
    original: Float32Array,
    listening: boolean
  ) => {
    const geometry = mesh.geometry as THREE.IcosahedronGeometry;
    const positionAttribute = (geometry as any).getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < positionAttribute.count; i++) {
      const baseX = original[i * 3];
      const baseY = original[i * 3 + 1];
      const baseZ = original[i * 3 + 2];

      const vertex = new THREE.Vector3(baseX, baseY, baseZ);

      const offset = ORB_RADIUS;
      const amp = 2.5 * intens;
      const time = performance.now();
      vertex.normalize();
      const rf = 0.00001;

      const distance =
        offset +
        volume * 4 * intens +
        noise3D(vertex.x + time * rf * 7, vertex.y + time * rf * 8, vertex.z + time * rf * 9) * amp * volume;

      vertex.multiplyScalar(distance);
      positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();

    if (listening) {
      // Color: blue for output, green for input
      let color;
      if (isSpeaking && outputVolume > 0.01) {
        color = new THREE.Color(`hsl(${200 + outputVolume * 40}, 100%, 60%)`);
      } else {
        color = new THREE.Color(`hsl(${volume * 120}, 100%, 50%)`);
      }
      (mesh.material as THREE.MeshLambertMaterial).color = color;
    } else {
      (mesh.material as THREE.MeshLambertMaterial).color.set(0xffffff);
    }
  };

  // --- Audio recording and backend upload logic ---

  // Start/stop recording and handle backend
  const handleOrbClick = async () => {
    setMicError(null);

    if (!isListening) {
      // Start listening and recording
      setIsListening(true);
      setStatus('Recording… (tap to stop)');
      setAudioUrl(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStreamRef.current = stream;
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          setIsBusy(true);
          setStatus('Uploading to backend…');
          try {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
            const formData = new FormData();
            formData.append('audio', audioBlob, 'audio.wav');

            const resp = await fetch(`${BACKEND_URL}/voice`, {
              method: 'POST',
              body: formData,
            });

            if (!resp.ok) {
              const txt = await resp.text();
              setStatus(`Server error: ${txt.slice(0, 160)}`);
              setIsBusy(false);
              return;
            }

            // Read the text reply (UTF-8 safe via encodeURIComponent)
            const replyHeader = resp.headers.get('x-reply-text');
            const replyText = replyHeader ? decodeURIComponent(replyHeader) : '';
            if (replyText) setStatus(`Captions: ${replyText}`);
            else setStatus('Downloading reply…');

            // Try to get audio file (mp3 or wav)
            const contentType = resp.headers.get('content-type') || '';
            const ab = await resp.arrayBuffer();
            let mime = 'audio/wav';
            if (contentType.includes('audio/mp3') || contentType.includes('audio/mpeg')) mime = 'audio/mp3';
            else if (contentType.includes('audio/wav')) mime = 'audio/wav';

            const blob = new Blob([ab], { type: mime });
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);
            setStatus('Reply audio ready.');
          } catch (e: any) {
            setStatus('Error uploading or playing audio.');
          }
          setIsBusy(false);
        };

        mediaRecorder.start();
      } catch (e: any) {
        setMicError(e?.message || String(e));
        setIsListening(false);
        setStatus('Mic error');
      }
    } else {
      // Stop listening and recording
      setIsListening(false);
      setStatus('Processing…');
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }
    }
  };

  // Output audio analysis for orb vibration
  useEffect(() => {
    // Clean up previous audio context if any
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
      outputAnalyserRef.current = null;
      outputDataArrayRef.current = null;
    }
    if (outputAnimationFrameRef.current) {
      cancelAnimationFrame(outputAnimationFrameRef.current);
      outputAnimationFrameRef.current = null;
    }
    setOutputVolume(0);
    setIsSpeaking(false);

    // Reset the MediaElementAudioSourceNode creation flag
    audioElementSourceCreatedRef.current = false;

    if (!audioUrl) return;

    // Wait for audio element to be ready
    const audioEl = audioElementRef.current;
    if (!audioEl) return;

    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;
    let rafId: number | null = null;
    let speaking = false;

    // Helper to disconnect all nodes from the audio element
    // (not needed, see below)

    const setup = () => {
      // Only create a MediaElementAudioSourceNode ONCE per audio element per page lifetime
      // If already created, reuse the same AudioContext and AnalyserNode
      // We'll use a hidden property on the audio element to store the source node
      // But since we want to analyze each new audio, we must create a new <audio> element each time

      // Instead, we will force the <audio> element to be replaced on each new audioUrl
      // (see below in the JSX)

      // But for safety, check if we've already created a source node for this element
      if (audioElementSourceCreatedRef.current) {
        setMicError(
          "Audio playback error: This browser does not allow connecting the same <audio> element to multiple AudioContexts. Please reload the page."
        );
        setIsSpeaking(false);
        setOutputVolume(0);
        return;
      }

      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      let source: MediaElementAudioSourceNode;
      try {
        source = ctx.createMediaElementSource(audioEl);
        audioElementSourceCreatedRef.current = true;
      } catch (err) {
        setMicError('Audio playback error: ' + (err instanceof Error ? err.message : String(err)));
        setIsSpeaking(false);
        setOutputVolume(0);
        return;
      }
      source.connect(analyser);
      analyser.connect(ctx.destination);
      dataArray = new Uint8Array(analyser.frequencyBinCount);

      outputAudioContextRef.current = ctx;
      outputAnalyserRef.current = analyser;
      outputDataArrayRef.current = dataArray;

      const update = () => {
        if (analyser && dataArray) {
          analyser.getByteTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const v = (dataArray[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          setOutputVolume(Math.min(1, rms * 2.5));
          // If audio is playing, set isSpeaking
          if (!speaking && !audioEl.paused && !audioEl.ended) {
            speaking = true;
            setIsSpeaking(true);
          }
          // If audio ended, stop speaking
          if (speaking && (audioEl.ended || audioEl.paused)) {
            speaking = false;
            setIsSpeaking(false);
            setOutputVolume(0);
          }
        }
        outputAnimationFrameRef.current = requestAnimationFrame(update);
      };
      update();
    };

    // Play audio automatically
    const playAudio = () => {
      // Some browsers require user interaction, but we try anyway
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
    };

    // Setup when metadata loaded
    const onLoaded = () => {
      // Before setting up, ensure any previous context is closed
      if (outputAudioContextRef.current) {
        outputAudioContextRef.current.close();
        outputAudioContextRef.current = null;
        outputAnalyserRef.current = null;
        outputDataArrayRef.current = null;
      }
      if (outputAnimationFrameRef.current) {
        cancelAnimationFrame(outputAnimationFrameRef.current);
        outputAnimationFrameRef.current = null;
      }
      setIsSpeaking(false);
      setOutputVolume(0);

      setup();
      playAudio();
    };

    audioEl.addEventListener('loadedmetadata', onLoaded);
    audioEl.addEventListener('play', () => setIsSpeaking(true));
    audioEl.addEventListener('ended', () => {
      setIsSpeaking(false);
      setOutputVolume(0);
    });
    audioEl.addEventListener('pause', () => {
      setIsSpeaking(false);
      setOutputVolume(0);
    });

    // If already loaded, setup immediately
    if (audioEl.readyState >= 1) {
      onLoaded();
    }

    return () => {
      audioEl.removeEventListener('loadedmetadata', onLoaded);
      if (outputAudioContextRef.current) {
        outputAudioContextRef.current.close();
        outputAudioContextRef.current = null;
        outputAnalyserRef.current = null;
        outputDataArrayRef.current = null;
      }
      if (outputAnimationFrameRef.current) {
        cancelAnimationFrame(outputAnimationFrameRef.current);
        outputAnimationFrameRef.current = null;
      }
      setIsSpeaking(false);
      setOutputVolume(0);
      // Reset the flag so a new <audio> element can be connected
      audioElementSourceCreatedRef.current = false;
    };
  }, [audioUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      if (outputAudioContextRef.current) {
        outputAudioContextRef.current.close();
        outputAudioContextRef.current = null;
        outputAnalyserRef.current = null;
        outputDataArrayRef.current = null;
      }
      if (outputAnimationFrameRef.current) {
        cancelAnimationFrame(outputAnimationFrameRef.current);
        outputAnimationFrameRef.current = null;
      }
      // Reset the flag so a new <audio> element can be connected
      audioElementSourceCreatedRef.current = false;
    };
    // eslint-disable-next-line
  }, []);

  // To avoid the MediaElementAudioSourceNode error, we must create a new <audio> element for each audioUrl.
  // We'll use a key prop on the <audio> element to force React to create a new element each time.
  // This ensures that each <audio> is only ever connected to one MediaElementAudioSourceNode.

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 500 }}>
      <div
        ref={containerRef}
        onClick={handleOrbClick}
        style={{
          width: '100%',
          aspectRatio: '1',
          cursor: isBusy ? 'wait' : 'pointer',
          filter: isSpeaking ? 'drop-shadow(0 0 24px #4af)' : undefined,
          transition: 'filter 0.2s',
        }}
      />
      {micError && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            left: 0,
            right: 0,
            padding: 8,
            backgroundColor: 'rgba(255,0,0,0.1)',
            borderRadius: 8,
            color: '#c00',
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          {micError}
        </div>
      )}
      <div
        style={{
          marginTop: 12,
          width: '90%',
          backgroundColor: 'rgba(0,0,0,0.07)',
          borderRadius: 8,
          padding: 8,
          minHeight: 60,
          maxHeight: 160,
          color: '#333',
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: 6, fontSize: 13 }}>Status</div>
        <div style={{ color: '#888', wordBreak: 'break-word' }}>{status}</div>
        {isBusy && <div style={{ color: '#888', marginTop: 4 }}>Working…</div>}
        {isSpeaking && (
          <div style={{ color: '#4af', marginTop: 4, fontWeight: 500 }}>
            <span role="img" aria-label="speaking">🔊</span> Orb is speaking...
          </div>
        )}
      </div>
      {/* Hidden audio element for output, auto-play */}
      <audio
        key={audioUrl || 'none'} // This forces a new <audio> element for each audioUrl
        ref={audioElementRef}
        src={audioUrl || undefined}
        style={{ display: 'none' }}
        autoPlay
        controls={false}
      />
      {/* Optionally, show a visible player for debugging */}
      {/* {audioUrl && (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <audio src={audioUrl} controls style={{ width: '100%' }} />
        </div>
      )} */}
    </div>
  );
};

export default Web3DOrb;