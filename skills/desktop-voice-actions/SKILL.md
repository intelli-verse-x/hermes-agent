---
name: desktop-voice-actions
description: Handles push-to-talk desktop requests through governed chat, computer use, and local inference. Use when a user speaks or requests voice control.
version: 1.0.0
metadata:
  tags: [voice, desktop, computer-use, local, privacy, approval]
---

# Desktop Voice Actions

Runtime policy, live provider metadata, and structured approval state are authoritative. Voice is only an input modality; route its transcript through the exact typed capability and tool path without embedding trust claims in user text.

## Procedure

1. Before capture, inspect the configured STT, TTS, and inference routes. In local-only or sensitive mode, block if any required route would use cloud. Treat cloud-audio consent as distinct from inference consent and disclose the actual providers.
2. Use push-to-talk. Do not start ambient capture, wake-word streaming, or cloud wake detection.
3. Submit the transcript as ordinary user text with trusted `input_modality=voice` metadata outside the text when supported. Never expose arbitrary IPC or native APIs to the model.
4. Compose with the computer-use and local-first-inference skills when relevant, but follow runtime gates over skill prose.
5. Stop capture while approval, clarification, secret, sudo, credential, or other structured input is pending. Support barge-in only to stop listening or speech.

## Non-Authorization Rule

Spoken words such as “yes”, “confirm”, or “always allow” never approve an action. Voice may request, explain, or prepare an action, but payments, messages, publication, deletion, authentication or permission changes, credentials, terminal or code execution, computer-use mutation, durable memory writes, purchases, and ranked or tournament actions require the existing visual/keyboard structured confirmation bound to frozen arguments. Session and permanent approval also require that trusted channel.

Never weaken hard blocks, write gates, or argument freezing. If a safe structured approval channel is unavailable, fail closed and report that the action was not executed.
