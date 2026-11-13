// Bounded-memory lexical GeoJSON coordinate-pair scanner (not JSON validation).
// Build: g++ -O3 -std=c++17 scripts/flood_coordinate_bounds.cpp -o /tmp/flood-bounds
#include <algorithm>
#include <vector>
#include <cstdint>
#include <charconv>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <string>

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  std::ifstream input(argv[1], std::ios::binary);
  if (!input) return 2;
  constexpr size_t block = 8 * 1024 * 1024;
  std::string carry, data;
  std::vector<char> buffer(block);
  double xmin=180, ymin=90, xmax=-180, ymax=-90;
  uint64_t count=0, bytes=0;
  bool quoted=false, escaped=false;
  auto whitespace=[](const char* p,const char* end) {
    while(p<end && (*p==' '||*p=='\r'||*p=='\n'||*p=='\t')) ++p;
    return p;
  };
  while (input) {
    input.read(buffer.data(), block);
    const size_t n=input.gcount();
    bytes += n;
    data=carry;
    data.append(buffer.data(),n);
    const size_t cutoff=(n && !input.eof()) ? (data.size()>256 ? data.size()-256 : 0) : data.size();
    const char* begin=data.data();
    const char* end=begin+data.size();
    size_t consumed=cutoff;
    for(size_t i=0;i<cutoff;++i) {
      char c=data[i];
      if(quoted) {
        if(escaped) escaped=false;
        else if(c=='\\') escaped=true;
        else if(c=='"') quoted=false;
        continue;
      }
      if(c=='"') { quoted=true; continue; }
      if(c!='[') continue;
      const char* p=whitespace(begin+i+1,end);
      double x,y;
      auto a=std::from_chars(p,end,x);
      if(a.ec!=std::errc()) continue;
      p=whitespace(a.ptr,end);
      if(p==end||*p!=',') continue;
      p=whitespace(p+1,end);
      auto b=std::from_chars(p,end,y);
      if(b.ec!=std::errc()) continue;
      p=whitespace(b.ptr,end);
      if(p==end||*p!=']') continue;
      if(!std::isfinite(x)||!std::isfinite(y)) return 3;
      xmin=std::min(xmin,x); ymin=std::min(ymin,y);
      xmax=std::max(xmax,x); ymax=std::max(ymax,y); ++count;
      i=p-begin;
      consumed=std::max(consumed,i+1);
    }
    carry=data.substr(consumed);
  }
  std::cout<<std::setprecision(17)<<"{\"source_bytes\":"<<bytes
    <<",\"lexical_coordinate_pair_count\":"<<count<<",\"lexical_bounds\":["
    <<xmin<<","<<ymin<<","<<xmax<<","<<ymax<<"]}\n";
}
