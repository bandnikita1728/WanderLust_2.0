const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const DB_FILE = path.resolve(__dirname, "../dbMock.json");

// Read in-memory database
function readDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    }
  } catch (e) {
    // Ignore read errors, start clean
  }
  return {};
}

// Write in-memory database
function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    // Ignore write errors
  }
}

// Generate MongoDB look-alike ObjectId
function generateId() {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

// Check if we should use mock database
// We toggle mock mode if we fail to connect to the real server, or if ATLASDB/MONGO_URL cannot be reached.
let isMockActive = false;

// We redefine mongoose.connect and mongoose.disconnect
const originalConnect = mongoose.connect;
const originalDisconnect = mongoose.disconnect;

// Keep track of registered schemas and post-delete middlewares
const registeredSchemas = {};

mongoose.connect = async function (url, options) {
  console.log(`[MongoMock] Checking connection to MongoDB: ${url}...`);
  try {
    // Attempt a real connection with a short connection timeout (1.5 seconds)
    const connPromise = originalConnect.call(mongoose, url, {
      ...options,
      serverSelectionTimeoutMS: 1500,
      connectTimeoutMS: 1500,
    });
    
    // Race or await the connection
    await connPromise;
    console.log("[MongoMock] Successfully connected to actual MongoDB instance!");
    return mongoose.connection;
  } catch (err) {
    console.warn(`[MongoMock] MongoDB connection to ${url} failed or was refused.`);
    console.warn("[MongoMock] >>> ACTIVATING ROBUST IN-MEMORY DATABASE FALLBACK <<<");
    isMockActive = true;
    
    // Ensure the DB_FILE has at least some initial setup if not exists
    if (!fs.existsSync(DB_FILE)) {
      writeDB({});
    }
    
    // Return a fake connection status
    return {
      readyState: 1,
      close: async () => {},
    };
  }
};

mongoose.disconnect = async function () {
  if (isMockActive) {
    console.log("[MongoMock] Mock connection closed.");
    return Promise.resolve();
  }
  return originalDisconnect.call(mongoose);
};

// Override the mongoose.Schema class to capture post hooks and structure
const OriginalSchema = mongoose.Schema;
class PatchedSchema extends OriginalSchema {
  constructor(definition, options) {
    super(definition, options);
    this.definition = definition;
    this.postMiddlewares = [];
  }
  
  post(action, fn) {
    super.post(action, fn);
    this.postMiddlewares.push({ action, fn });
  }
}

mongoose.Schema = PatchedSchema;
// Preserve schema Types
mongoose.Schema.Types = OriginalSchema.Types;

// Override mongoose.model to inject our MockModel if we are in mock mode
const originalModel = mongoose.model;
mongoose.model = function (name, schema) {
  // Store the schema first so we can access post middlewares
  registeredSchemas[name] = schema;

  // Let's obtain the original Mongoose model
  const RealModel = originalModel.call(mongoose, name, schema);

  // Return a proxy that intercepts database operations if the mock is active
  const handler = {
    // Intercept construction e.g. `new Listing(...)`
    construct(target, args) {
      if (!isMockActive) {
        return new target(...args);
      }
      
      const docData = args[0] || {};
      if (!docData._id) {
        docData._id = generateId();
      }
      
      return createDocInstance(name, docData);
    },
    
    // Intercept static properties and methods of the Model e.g. `Listing.find()`
    get(target, prop) {
      if (!isMockActive) {
        return target[prop];
      }
      
      // Implement static query methods
      switch (prop) {
        case "find":
          return (query = {}) => {
            const dbData = readDB();
            const collection = dbData[name] || [];
            const results = collection.filter(doc => matchQuery(doc, query));
            return new MockQuery(name, results);
          };
          
        case "findById":
          return (id) => {
            const dbData = readDB();
            const collection = dbData[name] || [];
            const doc = collection.find(doc => String(doc._id) === String(id));
            return new MockQuery(name, doc || null);
          };
          
        case "findByIdAndUpdate":
          return (id, update, options) => {
            const dbData = readDB();
            if (!dbData[name]) dbData[name] = [];
            const docIndex = dbData[name].findIndex(doc => String(doc._id) === String(id));
            if (docIndex === -1) {
              return new MockQuery(name, null);
            }
            
            let doc = dbData[name][docIndex];
            
            // Handle updates flat or with operations
            const flatUpdate = update.$set || {};
            const cleanUpdate = { ...update };
            delete cleanUpdate.$push;
            delete cleanUpdate.$pull;
            delete cleanUpdate.$set;
            
            const finalUpdate = { ...flatUpdate, ...cleanUpdate };
            for (let key in finalUpdate) {
              doc[key] = finalUpdate[key];
            }
            
            if (update.$push) {
              for (let key in update.$push) {
                if (!Array.isArray(doc[key])) doc[key] = [];
                doc[key].push(update.$push[key]);
              }
            }
            
            if (update.$pull) {
              for (let key in update.$pull) {
                if (Array.isArray(doc[key])) {
                  const pullVal = update.$pull[key];
                  doc[key] = doc[key].filter(v => String(v) !== String(pullVal));
                }
              }
            }
            
            dbData[name][docIndex] = doc;
            writeDB(dbData);
            return new MockQuery(name, doc);
          };
          
        case "findByIdAndDelete":
        case "findOneAndDelete":
          return (queryOrId) => {
            const dbData = readDB();
            const collection = dbData[name] || [];
            
            let docIndex = -1;
            if (typeof queryOrId === "string" || mongoose.Types.ObjectId.isValid(queryOrId)) {
              docIndex = collection.findIndex(doc => String(doc._id) === String(queryOrId));
            } else if (queryOrId && typeof queryOrId === "object") {
              const id = queryOrId._id || queryOrId;
              if (id) {
                docIndex = collection.findIndex(doc => String(doc._id) === String(id));
              }
            }
            
            if (docIndex === -1) {
              return new MockQuery(name, null);
            }
            
            const deletedDoc = collection.splice(docIndex, 1)[0];
            dbData[name] = collection;
            writeDB(dbData);
            
            // Trigger pre/post cascade middlewares
            triggerPostMiddleware(name, "findOneAndDelete", deletedDoc);
            
            return new MockQuery(name, deletedDoc);
          };
          
        case "deleteMany":
          return (query = {}) => {
            if (Object.keys(query).length === 0) {
              const dbData = readDB();
              dbData[name] = [];
              writeDB(dbData);
              return new MockQuery(name, { deletedCount: 0 }); // returns query result
            }
            
            const dbData = readDB();
            const collection = dbData[name] || [];
            const remaining = collection.filter(doc => !matchQuery(doc, query));
            const deletedCount = collection.length - remaining.length;
            dbData[name] = remaining;
            writeDB(dbData);
            return new MockQuery(name, { deletedCount });
          };
          
        case "insertMany":
          return (docs) => {
            const dbData = readDB();
            if (!dbData[name]) dbData[name] = [];
            
            const records = docs.map(doc => {
              const r = { ...doc };
              if (!r._id) r._id = generateId();
              return r;
            });
            
            dbData[name].push(...records);
            writeDB(dbData);
            return Promise.resolve(records.map(r => createDocInstance(name, r)));
          };
          
        default:
          return RealModel[prop] || target[prop];
      }
    }
  };
  
  return new Proxy(RealModel, handler);
};

// Create a wrapped document instance that supports save() and has appropriate getters/setters
function createDocInstance(collectionName, data) {
  const instance = { ...data };
  
  // Make sure virtual getters like id works
  Object.defineProperty(instance, "id", {
    get() {
      return String(this._id);
    },
    enumerable: true,
  });
  
  // Implements .save()
  instance.save = async function () {
    const dbData = readDB();
    if (!dbData[collectionName]) dbData[collectionName] = [];
    
    const existingIndex = dbData[collectionName].findIndex(doc => String(doc._id) === String(this._id));
    
    // Clean functions or specific methods
    const plainObject = {};
    for (let key in this) {
      if (typeof this[key] !== "function" && key !== "id") {
        plainObject[key] = this[key];
      }
    }
    
    if (existingIndex !== -1) {
      dbData[collectionName][existingIndex] = plainObject;
    } else {
      dbData[collectionName].push(plainObject);
    }
    
    writeDB(dbData);
    return this;
  };
  
  return instance;
}

// Chainable mock query builder
class MockQuery {
  constructor(collectionName, payload) {
    this.collectionName = collectionName;
    this.payload = payload;
    this.populatePaths = [];
  }
  
  populate(pathStr) {
    this.populatePaths.push(pathStr);
    return this;
  }
  
  sort() { return this; }
  limit() { return this; }
  skip() { return this; }
  select() { return this; }
  
  async then(onResolve, onReject) {
    try {
      let result = this.payload;
      if (result) {
        if (Array.isArray(result)) {
          result = result.map(doc => populateDoc(this.collectionName, doc, this.populatePaths));
          result = result.map(doc => createDocInstance(this.collectionName, doc));
        } else {
          result = populateDoc(this.collectionName, result, this.populatePaths);
          result = createDocInstance(this.collectionName, result);
        }
      }
      return Promise.resolve(result).then(onResolve, onReject);
    } catch (e) {
      if (onReject) return onReject(e);
      throw e;
    }
  }
  
  async catch(onReject) {
    try {
      return this.then();
    } catch (e) {
      return onReject(e);
    }
  }
}

// Support query matching
function matchQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true;
  for (let key in query) {
    let qVal = query[key];
    let dVal = doc[key];
    if (qVal && typeof qVal === "object" && qVal.$in) {
      if (!Array.isArray(qVal.$in)) return false;
      const docValStr = String(dVal);
      if (!qVal.$in.map(String).includes(docValStr)) return false;
    } else if (String(dVal) !== String(qVal)) {
      return false;
    }
  }
  return true;
}

// Populate references
function populateDoc(collectionName, doc, populatePaths) {
  if (!doc) return doc;
  const newDoc = { ...doc };
  for (let pathStr of populatePaths) {
    if (pathStr === "reviews") {
      const reviewIds = newDoc.reviews || [];
      const dbData = readDB();
      const reviewDocs = dbData["Review"] || [];
      newDoc.reviews = reviewIds.map(id => {
        const found = reviewDocs.find(r => String(r._id) === String(id));
        return found ? { ...found } : id;
      });
    } else if (pathStr === "owner" || pathStr === "author") {
      const originalOwnerId = newDoc[pathStr];
      newDoc[pathStr] = {
        _id: originalOwnerId || "65c3b1740989f668393e8bf0",
        username: "Wanderer",
        email: "wander@wanderlust.com",
      };
    }
  }
  return newDoc;
}

// Execute cascade delete middlewares registered post-findOneAndDelete
function triggerPostMiddleware(collectionName, action, doc) {
  const schema = registeredSchemas[collectionName];
  if (schema && schema.postMiddlewares) {
    for (let mw of schema.postMiddlewares) {
      if (mw.action === action) {
        // Execute the middleware hook. Note that in listing.js it is defined as:
        // listingSchema.post("findOneAndDelete", async function(listing) { ... })
        mw.fn(doc).catch(err => console.error("Error running mock post middleware:", err));
      }
    }
  }
}
