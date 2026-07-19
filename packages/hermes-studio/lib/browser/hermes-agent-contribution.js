var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { MessageService } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
export const HERMES_STUDIO_COMMANDS = Object.freeze({
    submitSelection: {
        id: 'hermes-agent.submitSelection',
        label: 'Hermes: Ask About Selection'
    },
    showRoute: {
        id: 'hermes-agent.showRoute',
        label: 'Hermes: Show Active AI Route'
    },
    reconnect: {
        id: 'hermes-agent.reconnect',
        label: 'Hermes: Reconnect Governed Session'
    }
});
/**
 * The editor contributes context and commands only. It deliberately has no
 * command for approval, provider credentials, policy changes, or direct shell
 * execution; those remain owned by the Hermes Desktop structured broker.
 */
let HermesAgentContribution = class HermesAgentContribution {
    messages;
    registerCommands(registry) {
        registry.registerCommand(HERMES_STUDIO_COMMANDS.submitSelection, {
            execute: () => this.messages.info('Selection queued for the governed Hermes session.')
        });
        registry.registerCommand(HERMES_STUDIO_COMMANDS.showRoute, {
            execute: () => this.messages.info('Route status is supplied by Hermes Desktop.')
        });
        registry.registerCommand(HERMES_STUDIO_COMMANDS.reconnect, {
            execute: () => this.messages.info('Reconnecting to the authenticated local broker…')
        });
    }
};
__decorate([
    inject(MessageService),
    __metadata("design:type", MessageService)
], HermesAgentContribution.prototype, "messages", void 0);
HermesAgentContribution = __decorate([
    injectable()
], HermesAgentContribution);
export { HermesAgentContribution };
