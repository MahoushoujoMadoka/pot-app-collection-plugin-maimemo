const logger = {
  log: (msg: string) => console.log(`[collection-plugin-maimemo] ${msg}`),
}

function isWordInNotepad(notepad: Notepad, word: string): boolean {
  for (const item of notepad.list) {
    if (item.type === 'WORD' && item.word?.toLowerCase() === word.toLowerCase()) {
      return true
    }
  }
  return false
}

async function collection(source: string, target: string, options: Options): Promise<void> {
  const { config, utils } = options
  const { http } = utils
  const { fetch, Body } = http

  const { api_token, word_list_title, enable_word_check = 'enable' } = config
  if (!api_token || !word_list_title) {
    throw 'API token 和 词本标题 不能为空'
  }

  if (!/^[a-f0-9]{64}$/i.test(api_token)) {
    throw 'API token 格式错误，应为64位十六进制字符串'
  }

  const trimmedWord = source.trim()
  const isEnableWordCheck = enable_word_check === 'enable'
  logger.log(`是否启用单词检测: ${isEnableWordCheck}`)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${api_token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  async function request<T = any>(
    endpoint: string,
    options: FetchOptions = {},
    errorMessage: string,
  ): Promise<ApiResponse<T>> {
    try {
      const url = `https://open.maimemo.com/open/api/v1${endpoint}`
      const res = await fetch(url, {
        ...options,
        headers: headers,
      })

      if (!res.ok) {
        throw `HTTP ${res.status}`
      }

      return res.data
    } catch (error) {
      throw `${errorMessage}: ${error}`
    }
  }

  async function findNotepadByTitle(title: string): Promise<BriefNotepad | null> {
    try {
      let offset = 0
      const limit = 10
      let totalFound = 0

      while (true) {
        const res = await request<ListNotepadsResponse>(
          `/notepads?limit=${limit}&offset=${offset}`,
          { method: 'GET' },
          '获取词本列表失败',
        )

        const notepads = res.data?.notepads || []
        totalFound += notepads.length

        for (let notepad of notepads) {
          if (notepad.title === title) {
            logger.log(`找到匹配的词本: "${notepad.title}" (ID: ${notepad.id})`)
            return notepad
          }
        }

        if (notepads.length < limit) {
          logger.log(`已到达最后一页，共查找了 ${totalFound} 个词本`)
          break
        }

        offset += limit
      }

      return null
    } catch (error) {
      throw `查找词本失败: ${error}`
    }
  }

  async function getNotepadDetail(notepadId: string): Promise<Notepad> {
    try {
      const res = await request<NotepadResponse>(
        `/notepads/${notepadId}`,
        { method: 'GET' },
        '获取词本详情失败',
      )

      const notepad = res.data?.notepad
      if (!notepad) {
        throw '词本详情数据格式错误'
      }

      return notepad
    } catch (error) {
      throw `获取词本详情失败: ${error}`
    }
  }

  async function createNotepad(title: string, word: string): Promise<Notepad> {
    const lowerCaseWord = word.toLowerCase()
    try {
      const notepadData: CreateNotepadRequest = {
        notepad: {
          status: 'PUBLISHED',
          content: lowerCaseWord,
          title: title,
          brief: `通过Pot插件创建的词本: ${title}`,
          tags: ['Pot'],
        },
      }

      const res = await request<NotepadResponse>(
        '/notepads',
        {
          method: 'POST',
          body: Body.json(notepadData),
        },
        '创建词本失败',
      )

      const notepad = res.data?.notepad
      if (!notepad) {
        throw '创建词本返回数据格式错误'
      }

      return notepad
    } catch (error) {
      throw `创建词本失败: ${error}`
    }
  }

  async function checkWordInVocabulary(originalWord: string): Promise<boolean> {
    const lowerWord = originalWord.toLowerCase()
    // 由于墨墨单词查询 API 大小写敏感且绝大部分单词为全小写，同时部分单词只有非小写或者仅有全小写形式，因此如果查询的单词本身是全小写，则只检查该单词；否则同时检查原始和小写形式以避免误判
    const wordsToCheck = lowerWord === originalWord ? [originalWord] : [lowerWord, originalWord]

    const results = await Promise.all(
      wordsToCheck.map((w) =>
        request<VocabularyResponse>(
          `/vocabulary?spelling=${w}`,
          { method: 'GET' },
          '检查单词收录失败',
        ),
      ),
    )

    for (let i = 0; i < results.length; i++) {
      if (results[i]?.data?.voc) {
        logger.log(`单词 "${wordsToCheck[i]}" 已被墨墨收录`)
        return true
      }
    }

    throw `单词 "${trimmedWord}" 未被墨墨收录`
  }

  async function updateNotepad(notepadDetail: Notepad, newWord: string): Promise<Notepad> {
    try {
      const lowerCaseNewWord = newWord.toLowerCase()
      const currentContent = notepadDetail.content

      const updatedContent = currentContent
        ? `${currentContent}\n${lowerCaseNewWord}`
        : lowerCaseNewWord

      const updateData: UpdateNotepadRequest = {
        notepad: {
          status: notepadDetail.status,
          content: updatedContent,
          title: notepadDetail.title,
          brief: notepadDetail.brief,
          tags: notepadDetail.tags,
        },
      }

      const res = await request<NotepadResponse>(
        `/notepads/${notepadDetail.id}`,
        {
          method: 'POST',
          body: Body.json(updateData),
        },
        '更新词本失败',
      )

      const notepad = res?.data?.notepad
      if (!notepad) {
        throw '更新词本返回数据格式错误'
      }

      return notepad
    } catch (error) {
      throw `更新词本失败: ${error}`
    }
  }

  const isSingleWord = !trimmedWord.includes(' ')

  if (isSingleWord) {
    if (isEnableWordCheck) {
      logger.log(`检测单词 "${trimmedWord}" 是否被墨墨收录...`)
      await checkWordInVocabulary(trimmedWord)
    } else {
      logger.log(`单词检测已禁用，跳过收录检测`)
    }
  } else {
    logger.log(`检测到输入包含多个单词，跳过收录检测`)
  }

  let notepad = await findNotepadByTitle(word_list_title)

  if (notepad) {
    const detail = await getNotepadDetail(notepad.id)

    if (isWordInNotepad(detail, trimmedWord)) {
      throw `单词 "${trimmedWord}" 已存在于词本 "${word_list_title}" 中`
    }

    logger.log(`单词 "${trimmedWord}" 不存在于词本 "${word_list_title}" 中`)
    await updateNotepad(detail, trimmedWord)
    logger.log(`成功将单词 "${trimmedWord}" 添加到词本 "${word_list_title}"`)
  } else {
    logger.log(`未找到现有词本，准备创建新词本...`)
    await createNotepad(word_list_title, trimmedWord)
    logger.log(`成功创建词本 "${word_list_title}" 并添加单词 "${trimmedWord}"`)
  }
}

/**
 * Maimemo OpenAPI Types
 * Generated from OpenAPI 3.0.1 specification
 */

// ============= Enums =============

/**
 * 云词本状态
 * - `PUBLISHED`: 发布
 * - `UNPUBLISHED`: 未发布
 * - `DELETED`: 删除
 */
type NotepadStatus = 'PUBLISHED' | 'UNPUBLISHED' | 'DELETED'

/**
 * 云词本类型
 * - `FAVORITE`: 我的收藏
 * - `NOTEPAD`: 云词本
 */
type NotepadType = 'FAVORITE' | 'NOTEPAD'

/**
 * 云词本解析结果项类型
 */
type NotepadParsedItemType = 'CHAPTER' | 'WORD'

// ============= Base Types =============

/**
 * 单词
 */
interface Vocabulary {
  /** id */
  id: string
  /** 拼写 */
  spelling: string
}

/**
 * 云词本解析结果
 */
interface NotepadParsedItem {
  /** 类型 */
  type: NotepadParsedItemType
  /** 章节 */
  chapter: string
  /** 单词 (当 type=WORD 时，该字段才有值) */
  word?: string
}

/**
 * 简要云词本
 */
interface BriefNotepad {
  /** id */
  id: string
  /** 类型 */
  type: NotepadType
  /** 创建者 id */
  creator: number
  /** 状态 */
  status: NotepadStatus
  /** 标题 */
  title: string
  /** 简介 */
  brief: string
  /** 标签 */
  tags: string[]
  /** 创建时间 (ISO 8601 格式) */
  created_time: string
  /** 更新时间 (ISO 8601 格式) */
  updated_time: string
}

/**
 * 云词本
 */
interface Notepad {
  /** id */
  id: string
  /** 类型 */
  type: NotepadType
  /** 创建者 id */
  creator: number
  /** 状态 */
  status: NotepadStatus
  /** 内容 */
  content: string
  /** 标题 */
  title: string
  /** 简介 */
  brief: string
  /** 标签 */
  tags: string[]
  /** 解析结果 */
  list: NotepadParsedItem[]
  /** 创建时间 (ISO 8601 格式) */
  created_time: string
  /** 更新时间 (ISO 8601 格式) */
  updated_time: string
}

// ============= Request Types =============

/**
 * 创建或更新云词本的请求数据
 */
interface NotepadInput {
  /** 状态 */
  status: NotepadStatus
  /** 内容 */
  content: string
  /** 标题 */
  title: string
  /** 简介 */
  brief: string
  /** 标签 */
  tags: string[]
}

/**
 * 创建云词本的请求体
 */
interface CreateNotepadRequest {
  notepad: NotepadInput
}

/**
 * 更新云词本的请求体
 */
interface UpdateNotepadRequest {
  notepad: NotepadInput
}

/**
 * 查询云词本的查询参数
 */
interface ListNotepadsQuery {
  /** 查询数量 */
  limit: number
  /** 查询跳过 */
  offset: number
  /** 词本 id 列表 */
  ids?: string[]
}

/**
 * 查询单词的查询参数
 */
interface QueryVocabularyQuery {
  /** 单词拼写 */
  spelling: string
}

// ============= Response Types =============

/**
 * 查询云词本的响应
 */
interface ListNotepadsResponse {
  notepads: BriefNotepad[]
}

/**
 * 获取/创建/更新云词本的响应
 */
interface NotepadResponse {
  notepad: Notepad
}

/**
 * 查询单词的响应
 */
interface VocabularyResponse {
  voc: Vocabulary
}

// ============= Plugin-specific Types =============

/**
 * HTTP 请求选项
 */
interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: any
}

/**
 * HTTP 响应
 */
interface FetchResponse {
  ok: boolean
  status: number
  data?: any
}

/**
 * HTTP 工具类
 */
interface HttpUtils {
  fetch: (url: string, options: FetchOptions) => Promise<FetchResponse>
  Body: {
    json: (data: any) => any
  }
}

/**
 * 工具类
 */
interface Utils {
  http: HttpUtils
}

/**
 * 插件配置
 */
interface Config {
  /** API Token (64位十六进制字符串) */
  api_token: string
  /** 词本标题 */
  word_list_title: string
  /** 是否启用单词检测 */
  enable_word_check?: 'enable' | 'disable'
}

/**
 * 插件选项
 */
interface Options {
  config: Config
  utils: Utils
}

/**
 * 通用 API 响应包装
 */
interface ApiResponse<T = any> {
  data?: T
}
