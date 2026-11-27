// One instance of each harness represents a server request. React cache compares
// arguments with Object.is; it must not merge distinct objects by JSON content.
function cache(fn) {
  const calls = [];
  return (...args) => {
    let entry = calls.find(call => call.args.length === args.length &&
      call.args.every((value, index) => Object.is(value, args[index])));
    if (!entry) {
      entry = { args };
      calls.push(entry);
      try { entry.value = fn(...args); }
      catch (error) { entry.error = error; entry.threw = true; }
    }
    if (entry.threw) throw entry.error;
    return entry.value;
  };
}

module.exports = { cache };
