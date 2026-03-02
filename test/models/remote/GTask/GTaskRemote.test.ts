import { gTaskIdentifierSchema, GTaskRemote, stringifyGTaskIdentifier } from 'src/models/remote/gtask/GTaskRemote';
import { GTaskSettingsData } from 'src/models/remote/gtask/GTaskSettings';
import { Task } from 'src/models/Task';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Google APIs
const mockGoogleTasks = {
  tasks: {
    get: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    list: vi.fn(),
  },
  tasklists: {
    list: vi.fn(),
  },
};

vi.mock('googleapis', () => ({
  google: {
    tasks: vi.fn(() => mockGoogleTasks),
  },
}));

// Mock GTaskAuthorization
vi.mock('src/models/remote/GTask/GTaskAuthorization', () => ({
  GTaskAuthorization: vi.fn().mockImplementation(() => ({
    init: vi.fn(),
    authorize: vi.fn(),
    unauthorize: vi.fn(),
    checkIsAuthorized: vi.fn(),
    ensureValidToken: vi.fn(),
    getAuthClient: vi.fn(() => ({})),
    dispose: vi.fn(),
  })),
}));

// Mock TurnIntoGoogleTaskCommand
vi.mock('src/models/remote/GTask/TurnIntoGoogleTaskCommand', () => ({
  registerTurnIntoGoogleTaskCommand: vi.fn(),
}));

describe('GTaskRemote', () => {
  let gTaskRemote: GTaskRemote;
  let mockApp: any;
  let mockPlugin: any;
  let mockSettings: GTaskSettingsData;

  /** Call after gTaskRemote.init() to ensure _auth mock methods are vi.fn() spies */
  function mockAuthMethods() {
    const auth = gTaskRemote['_auth'];
    if (auth) {
      auth.ensureValidToken = vi.fn();
    }
  }

  beforeEach(() => {
    mockApp = {
      vault: {
        getFileByPath: vi.fn(),
      },
      loadLocalStorage: vi.fn(),
      saveLocalStorage: vi.fn(),
    };

    mockPlugin = {
      updateSettings: vi.fn(),
    };

    mockSettings = {
      googleClientId: 'test-client-id',
      googleClientSecret: 'test-client-secret',
    };

    gTaskRemote = new GTaskRemote(mockApp, mockPlugin, mockSettings);

    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create GTaskRemote with correct properties', () => {
      expect(gTaskRemote.id).toBe('gtask');
      expect(gTaskRemote.name).toBe('Google Tasks');
      expect(gTaskRemote.settingTab).toBeDefined();
    });
  });

  describe('init', () => {
    it('should initialize when credentials are provided', async () => {
      await gTaskRemote.init();

      expect(gTaskRemote['_auth']).toBeDefined();
      expect(gTaskRemote['_client']).toBeDefined();
    });

    it('should not initialize when credentials are missing', async () => {
      const remoteWithoutCreds = new GTaskRemote(mockApp, mockPlugin, {
        googleClientId: null,
        googleClientSecret: null,
      });

      await remoteWithoutCreds.init();

      expect(remoteWithoutCreds['_auth']).toBeUndefined();
      expect(remoteWithoutCreds['_client']).toBeUndefined();
    });
  });

  describe('authorization methods', () => {
    beforeEach(async () => {
      await gTaskRemote.init();
    });

    it('should call authorize on auth instance', async () => {
      const mockAuth = gTaskRemote['_auth'];
      if (mockAuth) {
        mockAuth.authorize = vi.fn();
      }

      await gTaskRemote.authorize();

      if (mockAuth) {
        expect(mockAuth.authorize).toHaveBeenCalled();
      }
    });

    it('should call unauthorize on auth instance', async () => {
      const mockAuth = gTaskRemote['_auth'];
      if (mockAuth) {
        mockAuth.unauthorize = vi.fn();
      }

      await gTaskRemote.unauthorize();

      if (mockAuth) {
        expect(mockAuth.unauthorize).toHaveBeenCalled();
      }
    });

    it('should call checkIsAuthorized on auth instance', async () => {
      const mockAuth = gTaskRemote['_auth'];
      if (mockAuth) {
        mockAuth.checkIsAuthorized = vi.fn().mockResolvedValue(true);
      }

      const result = await gTaskRemote.checkIsAuthorized();

      if (mockAuth) {
        expect(mockAuth.checkIsAuthorized).toHaveBeenCalled();
      }
      expect(result).toBe(true);
    });

    it('should return false when auth is not available', async () => {
      const remoteWithoutAuth = new GTaskRemote(mockApp, mockPlugin, mockSettings);

      const result = await remoteWithoutAuth.checkIsAuthorized();

      expect(result).toBe(false);
    });
  });

  describe('authorize() lazy init', () => {
    it('should create _auth and _client when called without prior init', () => {
      expect(gTaskRemote['_auth']).toBeUndefined();
      expect(gTaskRemote['_client']).toBeUndefined();

      gTaskRemote['ensureAuth']();

      expect(gTaskRemote['_auth']).toBeDefined();
      expect(gTaskRemote['_client']).toBeDefined();
    });

    it('should throw error when settings are missing', () => {
      const remoteWithoutCreds = new GTaskRemote(mockApp, mockPlugin, {
        googleClientId: null,
        googleClientSecret: null,
      });

      expect(() => remoteWithoutCreds['ensureAuth']()).toThrow(
        'Google Client ID and Secret are required.',
      );
    });

    it('should call _auth.authorize() after lazy init', async () => {
      gTaskRemote['ensureAuth']();
      const mockAuth = gTaskRemote['_auth']!;
      mockAuth.authorize = vi.fn();

      await gTaskRemote.authorize();

      expect(mockAuth.authorize).toHaveBeenCalled();
    });
  });

  describe('assure', () => {
    it('should return client when initialized', async () => {
      await gTaskRemote.init();
      mockAuthMethods();

      const client = await gTaskRemote['assure']();

      expect(client).toBeDefined();
    });

    it('should throw error when not initialized', async () => {
      await expect(gTaskRemote['assure']()).rejects.toThrow(
        "There's no authentication. Please login to Google at Settings.",
      );
    });

    it('should call ensureValidToken before returning client', async () => {
      await gTaskRemote.init();
      const mockAuth = gTaskRemote['_auth']!;
      mockAuth.ensureValidToken = vi.fn();

      await gTaskRemote['assure']();

      expect(mockAuth.ensureValidToken).toHaveBeenCalled();
    });

    it('should propagate ensureValidToken error', async () => {
      await gTaskRemote.init();
      const mockAuth = gTaskRemote['_auth']!;
      mockAuth.ensureValidToken = vi.fn().mockRejectedValue(
        new Error('Token refresh failed. Please re-authorize in Settings.'),
      );

      await expect(gTaskRemote['assure']()).rejects.toThrow(
        'Token refresh failed. Please re-authorize in Settings.',
      );
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      await gTaskRemote.init();
      mockAuthMethods();
    });

    it('should get task successfully', async () => {
      const mockTaskData = {
        id: 'task-123',
        title: 'Test Task',
        status: 'needsAction',
        due: '2024-01-15T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      };

      mockGoogleTasks.tasks.get.mockResolvedValue({
        data: mockTaskData,
        status: 200,
      });

      const task = await gTaskRemote.get('list-1;task-123');

      expect(mockGoogleTasks.tasks.get).toHaveBeenCalledWith({
        task: 'task-123',
        tasklist: 'list-1',
      });
      expect(task.title).toBe('Test Task');
      expect(task.completed).toBe(false);
      expect(task.dueDate).toBe('2024-01-15');
    });

    it('should handle completed task', async () => {
      const mockTaskData = {
        id: 'task-456',
        title: 'Completed Task',
        status: 'completed',
        updated: '2024-01-01T00:00:00Z',
      };

      mockGoogleTasks.tasks.get.mockResolvedValue({
        data: mockTaskData,
        status: 200,
      });

      const task = await gTaskRemote.get('list-1;task-456');

      expect(task.completed).toBe(true);
    });

    it('should throw error on invalid identifier', async () => {
      await expect(gTaskRemote.get('invalid-identifier')).rejects.toThrow();
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await gTaskRemote.init();
      mockAuthMethods();
    });

    it('should update task successfully', async () => {
      const task = new Task('Updated Task', gTaskRemote, 'list-1;task-123', true, '2024-01-15');

      mockGoogleTasks.tasks.update.mockResolvedValue({ status: 200 });

      await gTaskRemote.update('list-1;task-123', task);

      expect(mockGoogleTasks.tasks.update).toHaveBeenCalledWith({
        task: 'task-123',
        tasklist: 'list-1',
        requestBody: {
          id: 'task-123',
          title: 'Updated Task',
          status: 'completed',
          due: '2024-01-15T00:00:00Z',
        },
      });
    });

    it('should handle task without due date', async () => {
      const task = new Task('Task without Due', gTaskRemote, 'list-1;task-123', false);

      mockGoogleTasks.tasks.update.mockResolvedValue({ status: 200 });

      await gTaskRemote.update('list-1;task-123', task);

      expect(mockGoogleTasks.tasks.update).toHaveBeenCalledWith({
        task: 'task-123',
        tasklist: 'list-1',
        requestBody: {
          id: 'task-123',
          title: 'Task without Due',
          status: 'needsAction',
          due: undefined,
        },
      });
    });
  });

  describe('create', () => {
    beforeEach(async () => {
      await gTaskRemote.init();
      mockAuthMethods();
    });

    it('should create task successfully', async () => {
      const mockCreatedTask = {
        id: 'new-task-123',
        title: 'New Task',
        status: 'needsAction',
      };

      mockGoogleTasks.tasks.insert.mockResolvedValue({
        data: mockCreatedTask,
        status: 200,
      });

      const task = await gTaskRemote.create('New Task', '2024-01-15', { tasklistId: 'list-1' });

      expect(mockGoogleTasks.tasks.insert).toHaveBeenCalledWith({
        tasklist: 'list-1',
        requestBody: {
          title: 'New Task',
          due: '2024-01-15T00:00:00Z',
        },
      });
      expect(task.title).toBe('New Task');
      expect(task.identifier).toBe('list-1;new-task-123');
    });

    it('should create task without due date', async () => {
      const mockCreatedTask = {
        id: 'new-task-456',
        title: 'Task without Due',
        status: 'needsAction',
      };

      mockGoogleTasks.tasks.insert.mockResolvedValue({
        data: mockCreatedTask,
        status: 200,
      });

      const task = await gTaskRemote.create('Task without Due', undefined, { tasklistId: 'list-1' });

      expect(mockGoogleTasks.tasks.insert).toHaveBeenCalledWith({
        tasklist: 'list-1',
        requestBody: {
          title: 'Task without Due',
        },
      });
      expect(task.dueDate).toBeUndefined();
    });
  });

  describe('getTasklists', () => {
    beforeEach(async () => {
      await gTaskRemote.init();
      mockAuthMethods();
    });

    it('should get tasklists successfully', async () => {
      const mockTasklists = [
        { id: 'list-1', title: 'Task List 1' },
        { id: 'list-2', title: 'Task List 2' },
      ];

      mockGoogleTasks.tasklists.list.mockResolvedValue({
        data: { items: mockTasklists },
        status: 200,
      });

      const tasklists = await gTaskRemote.getTasklists();

      expect(mockGoogleTasks.tasklists.list).toHaveBeenCalled();
      expect(tasklists).toEqual(mockTasklists);
    });
  });

  describe('getTasks', () => {
    beforeEach(async () => {
      await gTaskRemote.init();
      mockAuthMethods();
    });

    it('should get tasks successfully', async () => {
      const mockTasks = [
        { id: 'task-1', title: 'Task 1', status: 'needsAction' },
        { id: 'task-2', title: 'Task 2', status: 'completed' },
      ];

      mockGoogleTasks.tasks.list.mockResolvedValue({
        data: { items: mockTasks },
        status: 200,
      });

      const tasks = await gTaskRemote.getTasks('list-1');

      expect(mockGoogleTasks.tasks.list).toHaveBeenCalledWith({
        tasklist: 'list-1',
        showCompleted: true,
        showHidden: true,
      });
      expect(tasks).toEqual(mockTasks);
    });
  });

  describe('getAllTasks', () => {
    beforeEach(async () => {
      await gTaskRemote.init();
      mockAuthMethods();
    });

    it('should get all tasks from default tasklist', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          title: 'Task 1',
          status: 'needsAction',
          due: '2024-01-15T00:00:00Z',
          updated: '2024-01-01T00:00:00Z',
        },
        {
          id: 'task-2',
          title: 'Task 2',
          status: 'completed',
          updated: '2024-01-02T00:00:00Z',
        },
      ];

      mockGoogleTasks.tasks.list.mockResolvedValue({
        data: { items: mockTasks },
        status: 200,
      });

      const tasks = await gTaskRemote.getAllTasks();

      expect(mockGoogleTasks.tasks.list).toHaveBeenCalledWith({
        tasklist: '@default',
        showCompleted: true,
        showHidden: true,
      });
      expect(tasks).toHaveLength(2);
      expect(tasks[0].identifier).toBe('@default;task-1');
      expect(tasks[1].identifier).toBe('@default;task-2');
    });
  });

  describe('dispose', () => {
    it('should dispose auth when available', async () => {
      await gTaskRemote.init();
      const mockAuth = gTaskRemote['_auth'];
      if (mockAuth) {
        mockAuth.dispose = vi.fn();
      }

      gTaskRemote.dispose();

      if (mockAuth) {
        expect(mockAuth.dispose).toHaveBeenCalled();
      }
    });
  });
});

describe('GTaskIdentifier utilities', () => {
  describe('gTaskIdentifierSchema', () => {
    it('should parse valid identifier', () => {
      const result = gTaskIdentifierSchema.parse('list-1;task-123');
      expect(result).toEqual({ tasklistId: 'list-1', taskId: 'task-123' });
    });

    it('should throw error for invalid identifier', () => {
      expect(() => gTaskIdentifierSchema.parse('invalid')).toThrow();
    });
  });

  describe('stringifyGTaskIdentifier', () => {
    it('should stringify identifier object', () => {
      const result = stringifyGTaskIdentifier({ tasklistId: 'list-1', taskId: 'task-123' });
      expect(result).toBe('list-1;task-123');
    });
  });
});
