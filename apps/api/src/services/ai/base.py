from typing import Optional
from uuid import uuid4
from langchain.agents import AgentExecutor
from langchain.text_splitter import CharacterTextSplitter
from langchain.embeddings.sentence_transformer import SentenceTransformerEmbeddings
from langchain_community.vectorstores import Chroma
from langchain.agents.openai_functions_agent.base import OpenAIFunctionsAgent
from langchain.prompts import MessagesPlaceholder
from langchain_community.chat_message_histories import RedisChatMessageHistory
from langchain_core.messages import SystemMessage
from langchain.agents.openai_functions_agent.agent_token_buffer_memory import (
    AgentTokenBufferMemory,
)
from langchain_community.chat_models import ChatOpenAI
from langchain.agents.agent_toolkits import (
    create_retriever_tool,
)

import chromadb

from config.config import get_learnhouse_config

client = chromadb.Client()


chat_history = []


def ask_ai(
    question: str,
    message_history,
    text_reference: str,
    message_for_the_prompt: str,
):
    # Get API Keys
    LH_CONFIG = get_learnhouse_config()
    openai_api_key = LH_CONFIG.ai_config.openai_api_key

    # split it into chunks
    text_splitter = CharacterTextSplitter(chunk_size=1000, chunk_overlap=0)
    documents = text_splitter.create_documents([text_reference])
    texts = text_splitter.split_documents(documents)

    # create the open-source embedding function
    embedding_function = SentenceTransformerEmbeddings(model_name="all-MiniLM-L6-v2")

    # load it into Chroma and use it as a retriever
    db = Chroma.from_documents(texts, embedding_function)
    tool = create_retriever_tool(
        db.as_retriever(),
        "find_context_text",
        "Find associated text to get context about a course or a lecture",
    )
    tools = [tool]

    llm = ChatOpenAI(temperature=0, api_key=openai_api_key, model_name="gpt-3.5-turbo")

    memory_key = "history"

    memory = AgentTokenBufferMemory(
        memory_key=memory_key, llm=llm, chat_memory=message_history, max_tokens=1000
    )

    system_message = SystemMessage(content=(message_for_the_prompt))

    prompt = OpenAIFunctionsAgent.create_prompt(
        system_message=system_message,
        extra_prompt_messages=[MessagesPlaceholder(variable_name=memory_key)],
    )

    agent = OpenAIFunctionsAgent(llm=llm, tools=tools, prompt=prompt)

    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        memory=memory,
        verbose=True,
        return_intermediate_steps=True,
        handle_parsing_errors=True,
    )

    return agent_executor({"input": question})


def get_chat_session_history(aichat_uuid: Optional[str] = None):
    # Init Message History
    session_id = aichat_uuid if aichat_uuid else f"aichat_{uuid4()}"

    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if redis_conn_string:
        message_history = RedisChatMessageHistory(
            url=redis_conn_string, ttl=2160000, session_id=session_id
        )
    else:
        print("Redis connection string not found, using local memory")
        message_history = []

    return {"message_history": message_history, "aichat_uuid": session_id}
