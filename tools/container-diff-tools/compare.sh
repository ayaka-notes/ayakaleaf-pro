. ./env.sh
docker pull ${OLD_VERSION}
docker pull ${NEW_VERSION}
docker history --no-trunc --format '{{.CreatedBy}}' ${OLD_VERSION} > history-old.txt
docker history --no-trunc --format '{{.CreatedBy}}' ${NEW_VERSION} > history-new.txt
diff history-old.txt history-new.txt > history-diff.txt

rm -rf old 
rm -rf new 

id=$(docker create ${OLD_VERSION})
mkdir -p old
docker export "$id" | tar -x -C old
docker rm "$id"

id=$(docker create ${NEW_VERSION})
mkdir -p new
docker export "$id" | tar -x -C new
docker rm "$id"

rm -rf delta
mkdir -p delta
rsync -a -c -m --compare-dest="$PWD/old" new/ delta/
find delta -mindepth 1 -type d -empty -delete
