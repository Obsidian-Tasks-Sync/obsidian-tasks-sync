import { Extension } from '@codemirror/state';
import { merge } from 'es-toolkit';
import { App, Notice, Plugin, PluginManifest } from 'obsidian';
import { TaskPlatform } from './libs/regexp';
import { GTaskRemote } from './models/remote/GTask/GTaskRemote';
import { GTaskSettingsData } from './models/remote/GTask/GTaskSettings';
import { Remote } from './models/remote/Remote';
import { SyncFromRemoteManager } from './models/remote/SyncFromRemoteManager';
import { TodoistRemote } from './models/remote/todoist/TodoistRemote';
import { TodoistSettingsData } from './models/remote/todoist/TodoistSettingTab';
import { FileRepository } from './repositories/FileRepository';
import { SettingTab } from './views/SettingTab';

export type PluginSettings = TodoistSettingsData & GTaskSettingsData;

const DEFAULT_SETTINGS: PluginSettings = {
  googleClientId: null,
  googleClientSecret: null,
  todoistApiToken: null,
};

export default class TaskSyncPlugin extends Plugin {
  private remotes: Remote[];

  private fileRepo: FileRepository;
  private statusBar: HTMLElement;
  private syncFromRemoteManager: SyncFromRemoteManager;
  private authCheckInterval: number | null = null;
  private isAuthorized = false;
  private settingTab: SettingTab | null = null;

  settings: PluginSettings;
  extensions: Extension[] = [];

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload() {
    //initialize
    await this.loadSettings();

    const gtaskRemote = new GTaskRemote(this.app, this, this.settings);
    const todoistRemote = new TodoistRemote(this.app, this, this.settings);

    this.remotes = [gtaskRemote, todoistRemote];
    this.fileRepo = new FileRepository(this.app, this);
    this.syncFromRemoteManager = new SyncFromRemoteManager(this.remotes, this.fileRepo, 5000);
    this.syncFromRemoteManager.start();

    // // 옵시디언에서 특정한 텍스트 타입 인식하게 하기 , SYNC 버튼 추가
    // this.extensions.push(createSyncFromRemoteExtension(this, this.fileRepo));

    // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    this.statusBar = this.addStatusBarItem();
    this.statusBar.setText('Initializing...');

    // [중요] Remote 초기화가 된 이후에 SettingTab이 초기화되어야 합니다.
    for (const remote of this.remotes) {
      await remote.init();
    }

    await this.fileRepo.init();

    this.setIsAuthorized(await this.remotes.every((remote) => remote.checkIsAuthorized()));

    this.settingTab = new SettingTab(this.app, this, this.remotes);
    this.addSettingTab(this.settingTab);

    this.extensions.forEach((extension) => this.registerEditorExtension(extension));
  }

  activateAuthCheckInterval(remote: Remote) {
    // 1.5초마다 연동 상태 확인
    this.authCheckInterval = window.setInterval(async () => {
      this.setIsAuthorized(await remote.checkIsAuthorized());

      if (this.isAuthorized) {
        new Notice('Authorized');

        this.fileRepo.init();
        this.disposeAuthCheckInterval();

        // 연동 상태 확인 중단 후에 설정 탭 표시
        if (this.settingTab != null) {
          this.settingTab.display();
        }
      }
    }, 1500);

    // 30초 후에 연동 상태 확인 중단
    window.setTimeout(this.disposeAuthCheckInterval.bind(this), 30_000);
  }

  disposeAuthCheckInterval() {
    if (this.authCheckInterval != null) {
      window.clearInterval(this.authCheckInterval);
      this.authCheckInterval = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async updateSettings(settings: Partial<PluginSettings>) {
    this.settings = merge(this.settings, settings);
    await this.saveData(this.settings);
  }

  getIsAuthorized() {
    return this.isAuthorized;
  }

  setIsAuthorized(isAuthorized: boolean) {
    this.isAuthorized = isAuthorized;
    this.onIsAuthorizedChanged(isAuthorized);
  }

  onIsAuthorizedChanged(isAuthorized: boolean) {
    if (isAuthorized) {
      this.statusBar.setText('Authorized');
    } else {
      this.statusBar.setText('Not authorized');
    }
  }

  getRemoteByPlatform(platform: TaskPlatform): Remote {
    const remote = this.remotes.find((remote) => remote.id === platform);
    if (remote == null) {
      throw new Error(`Remote ${platform} not found`);
    }
    return remote;
  }

  onunload() {
    this.remotes.forEach((remote) => remote.dispose?.());
    this.fileRepo.dispose();
    this.settingTab?.dispose();
    this.disposeAuthCheckInterval();
  }
}
