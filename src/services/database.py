import pymongo

# MongoDB
client = pymongo.MongoClient("mongodb://learnhouse:learnhouse@mongo:27017/") # type: ignore
learnhouseDB = client["learnhouse"]


async def create_database():
    learnhouseDB = client["learnhouse"]


async def check_database():
    # Check if database learnhouse exists

    if "learnhouse" in client.list_database_names():
        return True
    else:
        await create_database()


async def create_config_collection():
    # Create config collection if it doesn't exist

    learnhouseDB = client["learnhouse"]
    config = learnhouseDB["config"]
    config.insert_one({"name": "LearnHouse", "date": "2022"})
    return config.find_one()
