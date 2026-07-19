import { CommandContribution } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/index.js';
import { ContainerModule } from '@theia/core/shared/inversify';
import { HermesAgentContribution } from './hermes-agent-contribution.js';
export default new ContainerModule(bind => {
    bind(HermesAgentContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(HermesAgentContribution);
    bind(FrontendApplicationContribution).toService(HermesAgentContribution);
});
