const logger = {
  log: (msg) => console.log(`[collection-plugin-maimemo] ${msg}`),
}

function isWordInNotepad(notepadContent, word) {
  const normalizedWord = word.toLowerCase()
  const lines = notepadContent.split('\n')
  for (const line of lines) {
    const trimmedLine = line.trim().toLowerCase()
    if (trimmedLine && trimmedLine === normalizedWord) {
      return true
    }
  }
  return false
}

async function collection(source, target, options = {}) {
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
  const headers = {
    Authorization: `Bearer ${api_token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  /**
   * @param {string} endpoint
   * @param {Object} options
   * @param {string} errorMessage
   * @returns {Promise<any>}
   */
  async function request(endpoint, options = {}, errorMessage) {
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
  async function findNotepadByTitle(title) {
    try {
      let offset = 0
      const limit = 10
      let totalFound = 0

      while (true) {
        const res = await request(
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

  async function getNotepadDetail(notepadId) {
    try {
      const res = await request(`/notepads/${notepadId}`, { method: 'GET' }, '获取词本详情失败')

      const notepad = res.data?.notepad
      if (!notepad) {
        throw '词本详情数据格式错误'
      }

      return { ...notepad, content: notepad.content || '' }
    } catch (error) {
      throw `获取词本详情失败: ${error}`
    }
  }

  async function createNotepad(title, word) {
    const lowerCaseWord = word.toLowerCase()
    try {
      const notepadData = {
        notepad: {
          status: 'PUBLISHED',
          content: lowerCaseWord,
          title: title,
          brief: `通过Pot插件创建的词本: ${title}`,
          tags: ['Pot'],
        },
      }

      const res = await request(
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

  async function checkWordInVocabulary(originalWord) {
    const lowerWord = originalWord.toLowerCase()
    // 由于墨墨单词查询 API 大小写敏感且大部分单词都为小写，如果用户查询的单词是全小写，则只检查小写单词，否则同时查询原始和小写版本
    const wordsToCheck = lowerWord === originalWord ? [originalWord] : [lowerWord, originalWord]

    const results = await Promise.all(
      wordsToCheck.map((w) =>
        request(`/vocabulary?spelling=${w}`, { method: 'GET' }, '检查单词收录失败'),
      ),
    )

    for (let i = 0; i < results.length; i++) {
      if (results[i]?.data?.voc) {
        logger.log(`单词 "${wordsToCheck[i]}" 已被墨墨收录`)
        return true
      }
    }

    throw `单词 "${originalWord}" 未被墨墨收录`
  }

  async function updateNotepad(notepadDetail, newWord) {
    try {
      const lowerCaseNewWord = newWord.toLowerCase()
      const currentContent = notepadDetail.content

      // 添加新单词
      const updatedContent = currentContent
        ? `${currentContent}\n${lowerCaseNewWord}`
        : lowerCaseNewWord

      const updateData = {
        notepad: {
          status: notepadDetail.status,
          content: updatedContent,
          title: notepadDetail.title,
          brief: notepadDetail.brief,
          tags: notepadDetail.tags,
        },
      }

      const res = await request(
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

    if (isWordInNotepad(detail.content, trimmedWord)) {
      throw `单词 "${trimmedWord}" 已存在于词本 "${word_list_title}" 中`
    }

    await updateNotepad(detail, trimmedWord)
    logger.log(`成功将单词 "${trimmedWord}" 添加到词本 "${word_list_title}"`)
  } else {
    logger.log(`未找到现有词本，准备创建新词本...`)
    await createNotepad(word_list_title, trimmedWord)
    logger.log(`成功创建词本 "${word_list_title}" 并添加单词 "${trimmedWord}"`)
  }
}
