from typing import Optional, Dict, Any
from uuid import uuid4
from langchain.agents import AgentExecutor
from langchain.text_splitter import CharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain.agents.openai_functions_agent.base import OpenAIFunctionsAgent
from langchain.prompts import MessagesPlaceholder
from langchain_community.chat_message_histories import RedisChatMessageHistory
from langchain_core.messages import SystemMessage
from langchain.agents.openai_functions_agent.agent_token_buffer_memory import (
    AgentTokenBufferMemory,
)
from langchain.agents.agent_toolkits import (
    create_retriever_tool,
)

import chromadb

from config.config import get_learnhouse_config
from src.services.ai.init import get_chromadb_client, get_embedding_function, get_llm

LH_CONFIG = get_learnhouse_config()
client = (
    chromadb.HttpClient(host=LH_CONFIG.ai_config.chromadb_config.db_host, port=8000)
    if LH_CONFIG.ai_config.chromadb_config.isSeparateDatabaseEnabled == True
    else chromadb.Client()
)

# Use efficient text splitter settings
TEXT_SPLITTER = CharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=100,
    separator="\n",
    length_function=len,
)

def ask_ai(
    question: str,
    message_history: Any,
    text_reference: str,
    message_for_the_prompt: str,
    embedding_model_name: str,
    openai_model_name: str,
) -> Dict[str, Any]:
    """
    Process an AI query with improved performance using cached components
    """
    # Get embedding function
    embedding_function = get_embedding_function(embedding_model_name)
    if not embedding_function:
        raise Exception(f"Embedding model {embedding_model_name} not found or API key not configured")

    # Split text into chunks efficiently
    documents = TEXT_SPLITTER.create_documents([text_reference])
    
    # Create vector store
    db = Chroma.from_documents(
        documents,
        embedding_function,
        client=get_chromadb_client()
    )
    
    # Create retriever tool
    retriever_tool = create_retriever_tool(
        db.as_retriever(search_kwargs={"k": 3}),
        "find_context_text",
        "Find associated text to get context about a course or a lecture",
    )
    
    # Get LLM
    llm = get_llm(openai_model_name)
    if not llm:
        raise Exception(f"LLM model {openai_model_name} not found or API key not configured")

    # Setup memory with optimized token limit
    memory = AgentTokenBufferMemory(
        memory_key="history",
        llm=llm,
        chat_memory=message_history,
        max_token_limit=2000,  # Increased for better context retention
    )

    # Create agent with system message
    system_message = SystemMessage(content=message_for_the_prompt)
    prompt = OpenAIFunctionsAgent.create_prompt(
        system_message=system_message,
        extra_prompt_messages=[MessagesPlaceholder(variable_name="history")],
    )

    agent = OpenAIFunctionsAgent(
        llm=llm,
        tools=[retriever_tool],
        prompt=prompt
    )

    # Create and execute agent
    agent_executor = AgentExecutor(
        agent=agent,
        tools=[retriever_tool],
        memory=memory,
        verbose=True,
        return_intermediate_steps=True,
        handle_parsing_errors=True,
        max_iterations=3,  # Limit maximum iterations for better performance
    )

    try:
        return agent_executor({"input": question})
    except Exception as e:
        raise Exception(f"Error processing AI request: {str(e)}")

def get_chat_session_history(aichat_uuid: Optional[str] = None) -> Dict[str, Any]:
    """Get or create a new chat session history"""
    session_id = aichat_uuid if aichat_uuid else f"aichat_{uuid4()}"
    
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if redis_conn_string:
        try:
            message_history = RedisChatMessageHistory(
                url=redis_conn_string,
                ttl=2160000,  # 25 days
                session_id=session_id
            )
        except Exception:
            print("Failed to connect to Redis, falling back to local memory")
            message_history = []
    else:
        print("Redis connection string not found, using local memory")
        message_history = []

    return {
        "message_history": message_history,
        "aichat_uuid": session_id
    }

