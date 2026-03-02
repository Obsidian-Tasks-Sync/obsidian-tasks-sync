import { assert } from 'es-toolkit';
import { google, tasks_v1 } from 'googleapis';
import { App, Notice } from 'obsidian';
import TaskSyncPlugin from 'src/main';
import { registerTurnIntoGoogleTaskCommand } from 'src/models/remote/GTask/TurnIntoGoogleTaskCommand';
import { z } from 'zod';
import { Task } from '../../Task';
import { Remote } from '../Remote';
import { GTaskAuthorization } from './GTaskAuthorization';
import { GTaskSettingsData, GTaskSettingTab } from './GTaskSettings';

// tasklistId;taskId 형식의 문자열과 객체 간 양방향 변환을 위한 타입
type GTaskIdentifier = {
  tasklistId: string;
  taskId: string;
};

// tasklistId;taskId 형식의 문자열을 객체로 파싱하는 스키마
export const gTaskIdentifierSchema = z
  .string()
  .regex(/^([^;]+);([^;]+)$/)
  .transform((str) => {
    const [tasklistId, taskId] = str.split(';');
    return { tasklistId, taskId } as GTaskIdentifier;
  });

// GTaskIdentifier 객체를 문자열로 변환하는 함수
export function stringifyGTaskIdentifier(identifier: GTaskIdentifier): string {
  return `${identifier.tasklistId};${identifier.taskId}`;
}

const createGTaskArgs = z.object({
  tasklistId: z.string(),
});

export class GTaskRemote implements Remote {
  id = 'gtask';
  name = 'Google Tasks';

  private static readonly DEFAULT_TASKLIST_ID = '@default'; // 기본 tasklist ID
  private _auth?: GTaskAuthorization;
  private _client?: tasks_v1.Tasks;
  settingTab: GTaskSettingTab;

  constructor(
    private app: App,
    private plugin: TaskSyncPlugin,
    private settings: GTaskSettingsData,
  ) {
    this.settingTab = new GTaskSettingTab(plugin, settings, this);
  }

  async init() {
    if (this.settings.googleClientId == null || this.settings.googleClientSecret == null) {
      return;
    }

    this._auth = new GTaskAuthorization(this.app, this.settings.googleClientId, this.settings.googleClientSecret);
    await this._auth.init();

    this._client = google.tasks({
      version: 'v1',
      auth: this._auth.getAuthClient(),
    });

    registerTurnIntoGoogleTaskCommand(this.plugin, this);
  }

  dispose() {
    this._auth?.dispose();
  }

  private ensureAuth() {
    if (this._auth == null) {
      if (this.settings.googleClientId == null || this.settings.googleClientSecret == null) {
        throw new Error('Google Client ID and Secret are required.');
      }
      this._auth = new GTaskAuthorization(this.app, this.settings.googleClientId, this.settings.googleClientSecret);
      this._client = google.tasks({
        version: 'v1',
        auth: this._auth.getAuthClient(),
      });
    }
  }

  async authorize() {
    this.ensureAuth();
    await this._auth!.authorize();
  }

  async unauthorize() {
    await this._auth?.unauthorize();
  }

  async checkIsAuthorized() {
    return (await this._auth?.checkIsAuthorized()) ?? false;
  }

  async assure() {
    if (this._client == null || this._auth == null) {
      throw new Error("There's no authentication. Please login to Google at Settings.");
    }

    // API 호출 전 토큰 갱신 보장
    await this._auth.ensureValidToken();

    return this._client;
  }

  async get(id: string): Promise<Task> {
    try {
      const { tasklistId, taskId } = gTaskIdentifierSchema.parse(id);

      const client = await this.assure();
      const { data, status } = await client.tasks.get({
        task: taskId,
        tasklist: tasklistId,
      });

      assert(status === 200, 'Failed to get task');
      assert(data.id != null, 'Task ID is null');
      assert(data.title != null, 'Task title is null');
      assert(data.status != null, 'Task status is null');

      const dueDate = data.due ? data.due.split('T')[0] : undefined;
      const updatedAt = data.updated ? data.updated : new Date().toISOString();

      return new Task(data.title, this, id, data.status === 'completed', dueDate, updatedAt);
    } catch (error) {
      new Notice(`Failed to get task: ${error.message}`);
      throw error;
    }
  }

  async update(id: string, from: Task): Promise<void> {
    try {
      const { tasklistId, taskId } = gTaskIdentifierSchema.parse(id);

      const client = await this.assure();
      await client.tasks.update({
        task: taskId,
        tasklist: tasklistId,
        requestBody: {
          id: taskId,
          title: from.title,
          status: from.completed ? 'completed' : 'needsAction',
          due: from.dueDate ? `${from.dueDate}T00:00:00Z` : undefined,
        },
      });
      new Notice('Task updated');
    } catch (error) {
      new Notice(`Failed to update task: ${error.message}`);
      throw error;
    }
  }

  async getTasklists() {
    const client = await this.assure();
    const { data, status } = await client.tasklists.list();
    assert(status === 200, 'Failed to get tasklists');
    assert(data.items != null, 'Tasklists are null');
    return data.items;
  }

  async getTasks(tasklistId: string) {
    const client = await this.assure();
    const { data, status } = await client.tasks.list({
      tasklist: tasklistId,
      showCompleted: true,
      showHidden: true,
    });
    assert(status === 200, 'Failed to get tasks');
    assert(data.items != null, 'Tasks are null');
    return data.items;
  }

  async create(title: string, due?: string, args: Record<string, string> = {}): Promise<Task> {
    const parsedArgs = createGTaskArgs.parse(args);
    const { tasklistId } = parsedArgs;

    const client = await this.assure();

    const requestBody: tasks_v1.Schema$Task = {
      title: title,
    };

    if (due) {
      requestBody.due = due + 'T00:00:00Z'; // Google Tasks API expects ISO 8601 format
    }

    const { data, status } = await client.tasks.insert({
      tasklist: tasklistId,
      requestBody,
    });

    assert(status === 200, 'Failed to create task');
    assert(data.id != null, 'Task ID is null');
    assert(data.title != null, 'Task title is null');

    const identifier = stringifyGTaskIdentifier({ tasklistId, taskId: data.id });
    return new Task(data.title, this, identifier, data.status === 'completed', due);
  }

  async getAllTasks(): Promise<Task[]> {
    const gTasks = await this.getTasks(GTaskRemote.DEFAULT_TASKLIST_ID);

    return gTasks.map((gTask) => {
      // id 필수값 체크
      if (!gTask.id || !gTask.title) {
        throw new Error('Invalid task data: missing id or title');
      }

      const taskId = stringifyGTaskIdentifier({
        tasklistId: GTaskRemote.DEFAULT_TASKLIST_ID,
        taskId: gTask.id,
      });

      return new Task(
        gTask.title,
        this,
        taskId,
        gTask.status === 'completed',
        gTask.due ? gTask.due.split('T')[0] : undefined,
        gTask.updated ? gTask.updated : new Date().toISOString(),
      );
    });
  }
}
