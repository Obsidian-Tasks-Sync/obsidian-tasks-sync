import { Setting } from 'obsidian';
import TaskSyncPlugin from 'src/main';
import { RemoteSettingPanel } from '../Remote';
import { GTaskRemote } from './GTaskRemote';

export interface GTaskSettingsData {
  googleClientId: string | null;
  googleClientSecret: string | null;
}

export class GTaskSettingTab extends RemoteSettingPanel<GTaskSettingsData> {
  constructor(plugin: TaskSyncPlugin, settings: GTaskSettingsData, remote: GTaskRemote) {
    super(plugin, settings, remote);
  }

  display(): void {
    const container = this.getContainer();
    container.empty();

    new Setting(container)
      .setName('Google Client Id')
      .setDesc('Please enter your Google Client ID.')
      .addText((text) =>
        text.setValue(this.data.googleClientId ?? '').onChange((value) => {
          this.update({ googleClientId: value.trim() });
          this.rerender();
        }),
      );

    new Setting(container)
      .setName('Client Secret')
      .setDesc('Please enter your Google Secret Key.')
      .addText((text) =>
        text.setValue(this.data.googleClientSecret ?? '').onChange((value) => {
          this.update({ googleClientSecret: value.trim() });
          this.rerender();
        }),
      );

    if (!this.plugin.getIsAuthorized()) {
      if (this.data.googleClientId == null || this.data.googleClientSecret == null) {
        container.createEl('p', { text: 'Please enter Google Client Id and Google Client Secret.' });
        return;
      }

      new Setting(container).setName('Connect Google Tasks').addButton((button) => {
        button.setButtonText('Connect').onClick(async () => {
          this.rerender();
          await this.remote.authorize();

          this.plugin.activateAuthCheckInterval(this.remote);
        });
      });
    } else {
      new Setting(container).setName('Connect Google Tasks').addButton((button) => {
        button.setButtonText('Disconnect').onClick(async () => {
          await this.remote.unauthorize();
          this.plugin.setIsAuthorized(false);
          this.rerender();
        });
      });
    }
  }
}
