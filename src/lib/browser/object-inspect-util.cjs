// object-inspect's optional Node `util.inspect` hook has no browser equivalent.
// Its own browser mapping declares this module absent; represent that absence
// as a normal empty module so reading `.custom` yields undefined.
module.exports = {};
