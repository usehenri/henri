if [ -z "$1" ]
  then
    echo "First argument should be version"
    exit -1
fi

if [ -z "$2" ]
  then
    echo "Second argument should be a tag"
    exit -1
fi

echo "$1"

npm version $1
npm publish --tag $2 --access public

for dir in ./packages/*; do (cd "$dir" && echo "" && echo "$dir" && npm version $1 && npm publish --tag $2 --access public); done