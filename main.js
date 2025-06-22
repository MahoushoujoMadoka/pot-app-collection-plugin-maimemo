const PLUGIN_NAME = '[collection-plugin-maimemo]: '
async function collection(source, target, options = {}) {
  const { config, utils } = options
  const { http } = utils
  const { fetch, Body } = http

  const { api_token, word_list_title } = config
  if (!api_token || !word_list_title) {
    throw 'API token 和 词本标题 不能为空'
  }

  const headers = {
    Authorization: `Bearer ${api_token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  async function findNotepadByTitle(title) {
    try {
      let offset = 0
      const limit = 10
      let totalFound = 0

      while (true) {
        let res = await fetch(
          `https://open.maimemo.com/open/api/v1/notepads?limit=${limit}&offset=${offset}`,
          {
            method: 'GET',
            headers: headers,
          },
        )

        if (!res.ok) {
          throw `获取词本列表失败: ${res.status}`
        }

        const {
          data: { notepads = [] },
        } = res.data
        totalFound += notepads.length

        for (let notepad of notepads) {
          if (notepad.title === title) {
            console.log(`${PLUGIN_NAME}找到匹配的词本: "${notepad.title}" (ID: ${notepad.id})`)
            return notepad
          }
        }

        if (notepads.length < limit) {
          console.log(`${PLUGIN_NAME}已到达最后一页，共查找了 ${totalFound} 个词本`)
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
      let res = await fetch(`https://open.maimemo.com/open/api/v1/notepads/${notepadId}`, {
        method: 'GET',
        headers: headers,
      })

      if (!res.ok) {
        throw `获取词本详情失败: ${res.status}`
      }

      return res.data.data.notepad
    } catch (error) {
      throw `获取词本详情失败: ${error}`
    }
  }

  async function createNotepad(title, word) {
    try {
      const notepadData = {
        notepad: {
          status: 'PUBLISHED',
          content: word,
          title: title,
          brief: `通过Pot创建的词本: ${title}`,
          tags: ['Pot'],
        },
      }

      let res = await fetch('https://open.maimemo.com/open/api/v1/notepads', {
        method: 'POST',
        headers: headers,
        body: Body.json(notepadData),
      })

      if (!res.ok) {
        throw `创建词本失败: ${res.status}`
      }

      return res.data.data.notepad
    } catch (error) {
      throw `创建词本失败: ${error}`
    }
  }

  async function updateNotepad(notepadDetail, newWord) {
    try {
      const currentContent = notepadDetail.content || ''

      const updatedContent = currentContent ? `${currentContent}\n${newWord}` : newWord

      const updateData = {
        notepad: {
          status: notepadDetail.status,
          content: updatedContent,
          title: notepadDetail.title,
          brief: notepadDetail.brief,
          tags: notepadDetail.tags,
        },
      }

      let res = await fetch(`https://open.maimemo.com/open/api/v1/notepads/${notepadDetail.id}`, {
        method: 'POST',
        headers: headers,
        body: Body.json(updateData),
      })

      if (!res.ok) {
        throw `更新词本失败: ${res.status}`
      }

      return res.data.data.notepad
    } catch (error) {
      throw `更新词本失败: ${error}`
    }
  }

  try {
    let notepad = await findNotepadByTitle(word_list_title)

    if (notepad) {
      const detail = await getNotepadDetail(notepad.id)
      await updateNotepad(detail, source)
      console.log(`${PLUGIN_NAME}成功将单词 "${source}" 添加到词本 "${word_list_title}"`)
    } else {
      console.log(`${PLUGIN_NAME}未找到现有词本，准备创建新词本...`)
      await createNotepad(word_list_title, source)
      console.log(`${PLUGIN_NAME}成功创建词本 "${word_list_title}" 并添加单词 "${source}"`)
    }
  } catch (error) {
    throw `操作失败: ${error}`
  }
}
